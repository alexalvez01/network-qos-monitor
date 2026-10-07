/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Register the WorkManager headless task at bundle load so a terminated-app
// wake finds its handler before any UI work (Stage 6, RF-07). The module
// self-guards when the native side is absent and must not reject.
import './src/background/backgroundTask';

AppRegistry.registerComponent(appName, () => App);
