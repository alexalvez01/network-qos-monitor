/**
 * Jest stub for react-native-maps (Stage 5).
 *
 * The native map has no Jest harness here, so the App test renders stub
 * components that pass children through. Heat math and tap hit-testing
 * are unit-tested in src/visualization/__tests__/heat.test.ts instead.
 */

const React = require('react');

function makeStub(name) {
  function Stub(props) {
    return React.createElement(React.Fragment, null, props.children);
  }
  Stub.displayName = name;
  return Stub;
}

module.exports = {
  __esModule: true,
  default: makeStub('MapView'),
  Circle: makeStub('MapCircle'),
  MapCircle: makeStub('MapCircle'),
  Marker: makeStub('MapMarker'),
  MapMarker: makeStub('MapMarker'),
  UrlTile: makeStub('MapUrlTile'),
  MapUrlTile: makeStub('MapUrlTile'),
  PROVIDER_DEFAULT: 'default',
  PROVIDER_GOOGLE: 'google',
};
