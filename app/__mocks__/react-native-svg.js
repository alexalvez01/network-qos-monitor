/**
 * Jest stub for react-native-svg (Stage 5).
 *
 * SVG rendering has no Jest harness here; chart path math is unit-tested
 * in src/visualization/__tests__/series.test.ts instead. Stubs render
 * nothing and pass children through so screens mount under the App test.
 */

const React = require('react');

function makeStub(name) {
  function Stub(props) {
    return React.createElement(React.Fragment, null, props.children);
  }
  Stub.displayName = name;
  return Stub;
}

const Svg = makeStub('Svg');

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Path: makeStub('SvgPath'),
  Line: makeStub('SvgLine'),
  Circle: makeStub('SvgCircle'),
  Text: makeStub('SvgText'),
  G: makeStub('SvgG'),
  Rect: makeStub('SvgRect'),
  Polyline: makeStub('SvgPolyline'),
  Polygon: makeStub('SvgPolygon'),
};
