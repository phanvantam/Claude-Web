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

// Log build version — verify production đang chạy đúng bản
declare const __BUILD_TIME__: string;
console.log(`[Claude Web] Build: ${typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev'}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
