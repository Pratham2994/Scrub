import { Route, Routes } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { Home } from '@/routes/Home';
import { OperationPanel } from '@/routes/OperationPanel';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/op/:name" element={<OperationPanel />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </AppShell>
  );
}
