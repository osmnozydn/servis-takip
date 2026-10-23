export interface Trip {
  id: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  driver_name: string | null;
  service_date: string;
  started_at: string;
  ended_at: string | null;
  end_reason: 'driver' | 'inactivity' | 'factory' | 'last_stop' | null;
  direction?: 'to_factory' | 'from_factory' | null;
  distance_m: number;
  position_count: number;
}

export interface StopEvent {
  id: string;
  trip_id: string;
  passenger_name: string | null;
  address: string | null;
  lat: number;
  lng: number;
  planned_order: number | null;
  status: 'pending' | 'arrived' | 'missed' | 'absent';
  arrived_at: string | null;
  departed_at: string | null;
  closest_m: number | null;
  closest_at: string | null;
}

export interface TrackPoint { lat: number; lng: number; recorded_at: string; speed: number | null }
