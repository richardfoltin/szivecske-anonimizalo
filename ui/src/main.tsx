import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installDevMock } from './devMock';
import './styles.css';

// Böngészőben futtatva helyettesítő adatot használunk, hogy a felületet az
// egész program elindítása nélkül is lehessen nézni. Az alkalmazásban ez a
// hívás nem csinál semmit.
installDevMock();

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
