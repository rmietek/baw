// Punkt wejściowy aplikacji — montuje główny komponent App do elementu #app w index.html.
// Globalny CSS ładowany tutaj (index.css) jest dostępny we wszystkich komponentach Svelte.
import App from './App.svelte';
import './index.css';
const app = new App({ target: document.getElementById('app') });
export default app;
