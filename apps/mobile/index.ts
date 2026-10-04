// Konum görevi, uygulama arka planda uyandırıldığında da tanımlı olmalı:
// bu yüzden her şeyden önce import edilir.
import './src/location/tracking';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
