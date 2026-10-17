// Same fractional scene coordinates and viewport center as TimelineQuickStateBridge.
export function timelinePlayheadX(state, second) {
  return state.timelineLeft + state.leadingCenteringPadding + (second - state.displayStartSeconds) * state.pixelsPerSecond;
}
export function timelineCenteredScroll(state, second) {
  return Math.max(0, Math.min(Math.max(0, state.contentWidth - state.viewportSize.width),
    timelinePlayheadX(state, second) - state.viewportSize.width / 2));
}
