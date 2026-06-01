<script>
  // Główny komponent aplikacji — konfiguruje routing, obsługuje wynik OAuth i inicjalizuje sesję.
  import { Router, Route, navigate } from 'svelte-routing';
  import { onMount } from 'svelte';
  import { initAuth, user } from './stores/auth';
  import ThreeBackground from './components/ThreeBackground.svelte';
  import SessionWarning from './components/SessionWarning.svelte';
  import LoginModal from './components/LoginModal.svelte';
  import Dashboard from './pages/Dashboard.svelte';

  // Flagi stanu OAuth — ustawiane na podstawie parametrów URL po powrocie od Google
  let need2fa        = false;  // użytkownik ma 2FA, wymagana weryfikacja TOTP
  let oauthMsg       = '';     // komunikat o błędzie OAuth (konto istnieje, błąd itp.)
  let oauthPreToken  = '';     // preAuthToken do przekazania do LoginModal (krok 2FA po OAuth)

  onMount(async () => {
    // Odczyt parametrów ?oauth=... po przekierowaniu z /api/auth/google/callback.
    // Po obsłudze parametry są usuwane z URL (replaceState) — brak śladów w historii.
    const params = new URLSearchParams(window.location.search);
    const oauth  = params.get('oauth');
    if (oauth === 'success') {
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauth === 'needs2fa') {
      oauthPreToken = params.get('pre') || '';
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauth === 'exists') {
      oauthMsg = 'Konto z tym adresem Google już istnieje. Zaloguj się zamiast rejestrować.';
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauth === 'error') {
      oauthMsg = 'Logowanie przez Google nie powiodło się. Spróbuj ponownie.';
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('need2fa')) {
      need2fa = true;
      window.history.replaceState({}, '', window.location.pathname);
    }
    await initAuth();
  });


</script>

<ThreeBackground />
<SessionWarning />
{#if need2fa}
  <div style="position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a0a0a;border:1px solid var(--red-dim);color:var(--red-bright);font-family:var(--mono);font-size:10px;letter-spacing:.15em;padding:10px 20px;pointer-events:none">
    ⚠ WYMAGANA WERYFIKACJA 2FA — skonfiguruj w Profilu
  </div>
{/if}
{#if oauthMsg}
  <div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center"
    on:click={() => oauthMsg = ''}>
    <div style="background:#0d0d0d;border:2px solid var(--red);padding:40px 50px;max-width:520px;text-align:center;font-family:var(--mono)">
      <div style="font-size:36px;margin-bottom:16px">⚠</div>
      <div style="font-size:16px;color:var(--red-bright);letter-spacing:.08em;margin-bottom:16px;line-height:1.6">
        Konto z tym adresem Google<br/>już istnieje w systemie.
      </div>
      <div style="font-size:12px;color:#aaa;letter-spacing:.1em;margin-bottom:28px">
        Przejdź do zakładki LOGOWANIE i zaloguj się<br/>używając przycisku "ZALOGUJ PRZEZ GOOGLE".
      </div>
      <div style="font-size:10px;color:#555;letter-spacing:.15em">KLIKNIJ ABY ZAMKNĄĆ</div>
    </div>
  </div>
{/if}
{#if oauthPreToken}
  <LoginModal
    onClose={() => oauthPreToken = ''}
    initialPreAuthToken={oauthPreToken}
  />
{/if}

<Router>
  <Route path="/" component={Dashboard} />
</Router>
