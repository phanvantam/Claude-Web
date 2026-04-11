import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import loader from '@monaco-editor/loader'
import './index.css'
import App from './App'

// Cấu hình Monaco Editor load từ local node_modules chỉ trong môi trường dev
// Trong production, để mặc định load từ CDN để tránh lỗi thiếu file trong thư mục dist
if (import.meta.env.DEV) {
  loader.config({
    paths: {
      vs: '/node_modules/monaco-editor/min/vs',
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
