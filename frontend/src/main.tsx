import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import loader from '@monaco-editor/loader'
import './index.css'
import App from './App'

// Cấu hình Monaco Editor load từ local node_modules thay vì CDN
// Path này được Vite serve qua fs.allow trong vite.config.ts
loader.config({
  paths: {
    vs: '/node_modules/monaco-editor/min/vs',
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
