import { Navigate, Route, Routes } from 'react-router-dom'
import { Sidebar } from './components/shell/Sidebar'
import { InspectorHost } from './components/inspector/InspectorHost'
import { TooltipProvider } from './components/Tooltip'
import { SearchProvider } from './components/search/SearchPalette'
import { SchedulePage } from './pages/SchedulePage'
import { ReservationsPage } from './pages/ReservationsPage'
import { VesselsPage } from './pages/VesselsPage'
import { BerthsPage } from './pages/BerthsPage'

export default function App() {
  return (
    <TooltipProvider>
      <SearchProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Routes>
              <Route path="/" element={<SchedulePage />} />
              <Route path="/reservations" element={<ReservationsPage />} />
              <Route path="/vessels" element={<VesselsPage />} />
              <Route path="/berths" element={<BerthsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          <InspectorHost />
        </div>
      </SearchProvider>
    </TooltipProvider>
  )
}
