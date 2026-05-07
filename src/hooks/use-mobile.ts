import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileBreakpoint,
    getIsMobileSnapshot,
    getServerSnapshot,
  );
}

function subscribeToMobileBreakpoint(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getIsMobileSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function getServerSnapshot() {
  return false;
}
