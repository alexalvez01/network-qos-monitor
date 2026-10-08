/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

import BackgroundFetch from 'react-native-background-fetch';
import { handleHeadlessEvent } from './src/background/backgroundTask';

// Register the WorkManager headless task synchronously at bundle load so a
// terminated-app wake finds its handler before any UI work (RF-07). The
// handler itself never rejects and loads its native deps lazily.
BackgroundFetch.registerHeadlessTask(handleHeadlessEvent);

AppRegistry.registerComponent(appName, () => App);
