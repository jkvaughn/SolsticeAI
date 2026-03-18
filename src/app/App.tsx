import { RouterProvider } from 'react-router';
import { router } from './routes';
import { ThemeProvider } from './components/ThemeProvider';
import { HeartbeatProvider } from './components/HeartbeatContext';
import { AuthProvider } from './contexts/AuthContext';
import { PersonaProvider } from './contexts/PersonaContext';

// CODA Agentic Payments — Solstice Network Demo
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PersonaProvider>
          <HeartbeatProvider>
            <RouterProvider router={router} />
          </HeartbeatProvider>
        </PersonaProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}