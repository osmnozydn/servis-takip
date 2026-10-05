// Basit canlı harita: Leaflet + OpenStreetMap (API anahtarı gerektirmez).
// Not: Canlıya çıkarken Google Maps'e (react-native-maps + API anahtarı) geçilecek;
// OSM'in genel tile sunucusu yoğun ticari kullanım için uygun değildir.
import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from './theme';

export type MapPoint = { lat: number; lng: number };
export interface LiveMapProps {
  vehicle?: MapPoint | null;
  stops?: (MapPoint & { label?: string; mine?: boolean })[];
  /** Yollardan geçen güzergâh (encoded polyline) */
  path?: string | null;
  height?: number;
}

const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{margin:0;height:100%;}
.bus{width:34px;height:34px;border-radius:17px;background:${colors.primary};border:3px solid ${colors.accent};color:#fff;font:700 15px system-ui;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.stop{width:22px;height:22px;border-radius:11px;background:#fff;border:3px solid ${colors.primary};font:700 11px system-ui;color:${colors.primary};display:flex;align-items:center;justify-content:center}
.stop.mine{background:${colors.accent};border-color:${colors.accent};color:#000}</style>
</head><body><div id="m"></div><script>
var map=L.map('m',{zoomControl:false,attributionControl:true}).setView([41.01,28.98],11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var bus=null, pathLayer=L.layerGroup().addTo(map), stopLayer=L.layerGroup().addTo(map), fitted=false, lastPath=null;
function decode(s){var o=[],i=0,lat=0,lng=0;while(i<s.length){for(var k=0;k<2;k++){var r=0,sh=0,b;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5;}while(b>=32&&i<s.length);var v=(r&1)?~(r>>1):(r>>1);if(k===0)lat+=v;else lng+=v;}o.push([lat/1e5,lng/1e5]);}return o;}
function update(d){
  stopLayer.clearLayers(); var pts=[];
  if(d.path!==lastPath){ lastPath=d.path; pathLayer.clearLayers();
    if(d.path){ var line=decode(d.path); L.polyline(line,{color:'#fff',weight:8,opacity:.9}).addTo(pathLayer); L.polyline(line,{color:'${colors.primary}',weight:5}).addTo(pathLayer); } }
  (d.stops||[]).forEach(function(s,i){
    L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',html:'<div class="stop'+(s.mine?' mine':'')+'">'+(s.mine?'D':(i+1))+'</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(stopLayer);
    pts.push([s.lat,s.lng]);
  });
  if(d.vehicle){
    var ll=[d.vehicle.lat,d.vehicle.lng];
    if(!bus){bus=L.marker(ll,{zIndexOffset:1000,icon:L.divIcon({className:'',html:'<div class="bus">S</div>',iconSize:[34,34],iconAnchor:[17,17]})}).addTo(map);}
    else bus.setLatLng(ll);
    pts.push(ll);
  } else if(bus){map.removeLayer(bus);bus=null;}
  if(!fitted && pts.length){ fitted=true; if(pts.length===1) map.setView(pts[0],15); else map.fitBounds(pts,{padding:[30,30]}); }
  else if(d.vehicle && d.follow){ map.panTo([d.vehicle.lat,d.vehicle.lng]); }
}
function onMsg(e){try{update(JSON.parse(e.data))}catch(_){}}
document.addEventListener('message',onMsg); window.addEventListener('message',onMsg);
</script></body></html>`;

export function LiveMap({ vehicle, stops = [], path, height = 280 }: LiveMapProps) {
  const ref = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const payload = useMemo(() => JSON.stringify({ vehicle, stops, path: path ?? null, follow: true }), [vehicle, stops, path]);

  useEffect(() => {
    if (Platform.OS === 'web') iframeRef.current?.contentWindow?.postMessage(payload, '*');
    else ref.current?.postMessage(payload);
  }, [payload]);

  if (Platform.OS === 'web') {
    // Web önizlemesi (geliştirme/test) için iframe
    return (
      <View style={[styles.wrap, { height }]}>
        <iframe
          ref={iframeRef}
          srcDoc={html}
          style={{ border: 0, width: '100%', height: '100%' }}
          onLoad={() => iframeRef.current?.contentWindow?.postMessage(payload, '*')}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html }}
        onLoadEnd={() => ref.current?.postMessage(payload)}
        javaScriptEnabled
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#E8EEF5' },
});
