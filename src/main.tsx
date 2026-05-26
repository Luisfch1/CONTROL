import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ProjectsProvider } from './context/ProjectsContext.tsx'
import { AgentProvider } from './context/AgentContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProjectsProvider>
      <AgentProvider>
        <App />
      </AgentProvider>
    </ProjectsProvider>
  </StrictMode>,
)
