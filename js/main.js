/* ============================================================
   main.js — Entry Point
   ============================================================
   This is the LAST script to load and the one that STARTS
   everything. Think of it as the "on/off switch" for the game.

   It does five things:
     1. Waits for the page to fully load
     2. Gets the canvas and sets its pixel dimensions
     3. Scales the canvas to fit the screen
     4. Creates the core systems (input, state manager, game loop)
     5. Pushes the first screen (Main Menu) and starts the loop

   GAME COORDINATE SYSTEM:
   All game logic uses a fixed 960 × 540 (16:9) space.
   The canvas is then scaled up or down with CSS to fill the
   screen — like zooming a photograph. This means you can
   always position things assuming a 960 × 540 canvas and
   they'll look right on any screen size.
   ============================================================ */

(function () {

  // --- Logical game dimensions (16:9 landscape) ---
  const GAME_WIDTH  = 960;
  const GAME_HEIGHT = 540;

  // Wait for the entire page (HTML + CSS) to load before starting
  window.addEventListener('load', function () {

    // --- Get the canvas ---
    const canvas = document.getElementById('gameCanvas');
    const ctx    = canvas.getContext('2d');

    // Set the canvas's internal resolution to our fixed game size
    canvas.width  = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;

    // ---- Scale to screen ----
    // This function runs once now and again whenever the browser is resized.
    // It sets CSS width/height to fill the screen while keeping 16:9 ratio.
    function resizeCanvas() {
      const scaleX = window.innerWidth  / GAME_WIDTH;
      const scaleY = window.innerHeight / GAME_HEIGHT;
      const scale  = Math.min(scaleX, scaleY); // Fit inside the screen (no cropping)

      canvas.style.width  = Math.floor(GAME_WIDTH  * scale) + 'px';
      canvas.style.height = Math.floor(GAME_HEIGHT * scale) + 'px';
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas(); // Run immediately to set the initial size

    // ---- Shared game data ----
    // This object travels between all game states, carrying information
    // that needs to persist (like which plane was chosen, or the score).
    const gameData = {
      mode:          null,  // 'pilot' or 'gunner'
      selectedPlane: null,  // The Plane object the player chose
      score:         0,     // Points accumulated in the current session
      result:        null,  // 'victory', 'defeated', or 'survived' (end-of-game)
    };

    // ---- Core systems ----
    const input        = new InputHandler(canvas, GAME_WIDTH, GAME_HEIGHT);
    const stateManager = new StateManager();
    const gameLoop     = new GameLoop(stateManager, ctx);

    // ---- Start on the Main Menu ----
    stateManager.change(new MainMenuState(stateManager, input, gameData));

    // ---- Begin the 60fps loop ----
    gameLoop.start();

    // ---- Development helper ----
    // Expose systems to the browser console for debugging.
    // Example: type  game.stateManager  in DevTools to inspect the state.
    // REMOVE or guard this before shipping a production release.
    window.game = { stateManager, input, gameLoop, gameData };
    console.log('%c My First Game — Foundation Ready ', 'background:#0d47a1;color:#fff;padding:4px 8px;border-radius:3px;');
    console.log('Open DevTools and type  game  to inspect systems.');
  });

}());
