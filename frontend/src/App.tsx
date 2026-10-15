import React from "react";
import { AgentGovernanceDashboard } from "./components/AgentGovernanceDashboard";
import { I18nProvider } from "./i18n";

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <AgentGovernanceDashboard />
    </I18nProvider>
  );
};

export default App;
