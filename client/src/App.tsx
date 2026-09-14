import { Route, Routes } from 'react-router';

import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/routes/EmptyState';
import { OperationPanel } from '@/routes/OperationPanel';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<EmptyState />} />
        <Route path="/op/:name" element={<OperationPanel />} />
        <Route path="*" element={<EmptyState />} />
      </Routes>
    </AppShell>
  );
}
