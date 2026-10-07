/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

jest.mock(
  '@react-native-community/netinfo',
  () =>
    jest.requireActual(
      '@react-native-community/netinfo/jest/netinfo-mock.js',
    ),
);

import App from '../App';

test('renders the stage 1 status screen', async () => {
  let root: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  expect(root).toBeDefined();
  const texts = (root as ReactTestRenderer.ReactTestRenderer).root
    .findAllByType(Text)
    .map(node => node.props.children);
  const flat = texts.flat(Infinity).join(' ');
  expect(flat).toMatch('Network QoS Monitor');
  expect(flat).toMatch('Request permissions');
});
