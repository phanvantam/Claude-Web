import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import AppLayout from './components/Layout/AppLayout';
import Dashboard from './pages/Dashboard';
import ChatPage from './pages/ChatPage';
import Settings from './pages/Settings';
import { useEffect, useState } from 'react';
import { socketService } from './services/socket';

function App() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = socketService.connect();
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    return () => {
      socketService.disconnect();
    };
  }, []);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#6c5ce7',
          colorBgContainer: '#1a1a2e',
          colorBgElevated: '#1e1e32',
          colorBorder: 'rgba(255,255,255,0.08)',
          colorText: '#e0e0e0',
          colorTextSecondary: 'rgba(255,255,255,0.45)',
          borderRadius: 10,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        components: {
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemSelectedBg: 'rgba(108, 92, 231, 0.15)',
            darkItemHoverBg: 'rgba(255,255,255,0.04)',
          },
          Card: {
            colorBgContainer: 'rgba(26, 26, 46, 0.6)',
          },
          Modal: {
            contentBg: '#1e1e32',
            headerBg: '#1e1e32',
          },
          Input: {
            colorBgContainer: 'rgba(255,255,255,0.04)',
            activeBorderColor: '#6c5ce7',
          },
          Select: {
            colorBgContainer: 'rgba(255,255,255,0.04)',
          },
          Button: {
            primaryShadow: '0 2px 8px rgba(108, 92, 231, 0.4)',
          },
        },
      }}
    >
      <BrowserRouter>
        <AppLayout isConnected={isConnected}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/chat/:projectId" element={<ChatPage />} />
            <Route path="/chat" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
