import {callback as call} from 'chart.js/helpers';
import Hammer from 'hammerjs';
import {doPan, doZoom} from './core';
import {getState} from './state';
import {directionEnabled, getEnabledScalesByPoint} from './utils';

function createEnabler(chart) {
  const state = getState(chart);
  return function(recognizer, event) {
    const panOptions = state.options.pan;
    if (!panOptions || !panOptions.enabled) {
      return false;
    }
    if (!event || !event.srcEvent) { // Sometimes Hammer queries this with a null event.
      return true;
    }
    const modifierKey = panOptions.modifierKey;
    const requireModifier = modifierKey && (event.pointerType === 'mouse');
    if (requireModifier && !event.srcEvent[modifierKey + 'Key']) {
      call(panOptions.onPanRejected, [{chart, event}]);
      return false;
    }
    return true;
  };
}

function pinchAxes(p0, p1) {
  // fingers position difference
  const pinchX = Math.abs(p0.clientX - p1.clientX);
  const pinchY = Math.abs(p0.clientY - p1.clientY);

  // diagonal fingers will change both (xy) axes
  const p = pinchX / pinchY;
  let x, y;
  if (p > 0.3 && p < 1.7) {
    x = y = true;
  } else if (pinchX > pinchY) {
    x = true;
  } else {
    y = true;
  }
  return {x, y};
}

function handlePinch(chart, state, e) {
  if (state.scale) {
    const {center, pointers} = e;
    // Hammer reports the total scaling. We need the incremental amount
    const zoomPercent = 1 / state.scale * e.scale;
    const rect = e.target.getBoundingClientRect();
    const pinch = pinchAxes(pointers[0], pointers[1]);
    const options = state.options.zoom;
    const mode = options.mode;
    const zoom = {
      x: pinch.x && directionEnabled(mode, 'x', chart) ? zoomPercent : 1,
      y: pinch.y && directionEnabled(mode, 'y', chart) ? zoomPercent : 1,
      focalPoint: {
        x: center.x - rect.left,
        y: center.y - rect.top
      }
    };

    doZoom(chart, zoom, options);

    // Keep track of overall scale
    state.scale = e.scale;
  }
}

function startPinch(chart, state) {
  if (state.options.zoom.enabled) {
    state.scale = 1;
  }
}

function endPinch(chart, state, e) {
  if (state.scale) {
    handlePinch(chart, state, e);
    state.scale = null; // reset
    call(state.options.zoom.onZoomComplete, [{chart}]);
  }
}


function handlePan(chart, state, e) {
  const delta = state.delta;
  if (delta !== null) {
    state.panning = true;
    doPan(chart, {x: e.deltaX - delta.x, y: e.deltaY - delta.y}, state.options.pan, state.panScales);
    state.delta = {x: e.deltaX, y: e.deltaY};
  }
}

function startPan(chart, state, e) {
  const {enabled, overScaleMode} = state.options.pan;
  if (!enabled) {
    return;
  }
  const rect = e.target.getBoundingClientRect();
  const point = {
    x: e.center.x - rect.left,
    y: e.center.y - rect.top
  };

  state.panScales = overScaleMode && getEnabledScalesByPoint(overScaleMode, point, chart);
  state.delta = {x: 0, y: 0};
  handlePan(chart, state, e);
}

function endPan(chart, state) {
  state.delta = null;
  if (state.panning) {
    setTimeout(() => (state.panning = false), 500);
    call(state.options.pan.onPanComplete, [{chart}]);
  }
}

const hammers = new WeakMap();
export function startHammer(chart, options) {
  const state = getState(chart);
  const canvas = chart.canvas;
  const {pan: panOptions, zoom: zoomOptions} = options;

  const mc = new Hammer.Manager(canvas);
  if (zoomOptions && zoomOptions.enabled) {
    mc.add(new Hammer.Pinch());
    mc.on('pinchstart', () => startPinch(chart, state));
    mc.on('pinch', (e) => handlePinch(chart, state, e));
    mc.on('pinchend', (e) => endPinch(chart, state, e));
  }

  if (panOptions && panOptions.enabled) {
    mc.add(new Hammer.Pan({
      threshold: panOptions.threshold,
      enable: createEnabler(chart)
    }));
    mc.on('panstart', (e) => startPan(chart, state, e));
    mc.on('panmove', (e) => handlePan(chart, state, e));
    mc.on('panend', () => endPan(chart, state));
  }

  hammers.set(chart, mc);
}

export function stopHammer(chart) {
  const mc = hammers.get(chart);
  if (mc) {
    mc.remove('pinchstart');
    mc.remove('pinch');
    mc.remove('pinchend');
    mc.remove('panstart');
    mc.remove('pan');
    mc.remove('panend');
    mc.destroy();
    hammers.delete(chart);
  }
}
