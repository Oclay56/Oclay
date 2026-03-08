import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import DashboardPage from './pages/dashboard'
import PositionsPage from './pages/positions'
import ExecutionsPage from './pages/executions'
import RiskPage from './pages/risk'
import BlocklistPage from './pages/blocklist'
import LatencyPage from './pages/latency'
import LeaderboardPage from './pages/leaderboard'
import AnalyzePage from './pages/analyze'
import StrategyPage from './pages/strategy'
import SystemPage from './pages/system'

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/positions" element={<PositionsPage />} />
        <Route path="/executions" element={<ExecutionsPage />} />
        <Route path="/risk" element={<RiskPage />} />
        <Route path="/blocklist" element={<BlocklistPage />} />
        <Route path="/latency" element={<LatencyPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/analyze" element={<AnalyzePage />} />
        <Route path="/strategy" element={<StrategyPage />} />
        <Route path="/strategies" element={<StrategyPage />} />
        <Route path="/system" element={<SystemPage />} />
      </Routes>
    </AppShell>
  )
}

export default App
