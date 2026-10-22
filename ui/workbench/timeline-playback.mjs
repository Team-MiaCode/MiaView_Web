// Same fractional scene coordinates and viewport center as TimelineQuickStateBridge.
export function timelinePlayheadX(state, second) {
  return state.timelineLeft + state.leadingCenteringPadding + (second - state.displayStartSeconds) * state.pixelsPerSecond;
}
export function timelineCenteredScroll(state, second) {
  return Math.max(0, Math.min(Math.max(0, state.contentWidth - state.viewportSize.width),
    timelinePlayheadX(state, second) - state.viewportSize.width / 2));
}

export function timelineSecondAtX(state, x, scroll = state.horizontalScrollValue) {
  return Math.max(0, Math.min(state.maxNavigableSecond,
    state.displayStartSeconds + (x + scroll - state.timelineLeft - state.leadingCenteringPadding) / state.pixelsPerSecond));
}

export function timelineZoomedScroll(state, second, zoomScale) {
  const pixelsPerSecond = 120 * Math.max(.25, zoomScale);
  // The native builder derives centering padding from the zero-second pixel at each zoom.
  const leadingCenteringPadding = Math.max(0, Math.floor(state.viewportSize.width / 2)
    - state.timelineLeft - Math.round(-state.displayStartSeconds * pixelsPerSecond));
  return Math.max(0, timelinePlayheadX({ ...state, pixelsPerSecond, leadingCenteringPadding }, second) - state.viewportSize.width / 2);
}
