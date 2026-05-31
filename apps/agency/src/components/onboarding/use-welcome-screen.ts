"use client";

import * as React from "react";

export type WelcomeScreenAgencyType = "autonomo" | "empresa";

export function useWelcomeScreen() {
  const [selectedType, setSelectedType] = React.useState<WelcomeScreenAgencyType | null>(null);

  const selectType = React.useCallback((type: WelcomeScreenAgencyType) => {
    setSelectedType(type);
  }, []);

  return {
    selectedType,
    selectType,
  };
}
