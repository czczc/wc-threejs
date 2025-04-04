# Cherenkov Light Simulation Demo

This is a web-based application that simulates and visualizes Cherenkov radiation produced by a relativistic muon passing through a simplified water Cherenkov detector. It uses Three.js for 3D rendering and visualization.

## Features

*   **3D Visualization:** Renders the cylindrical water detector, PhotoMultiplier Tubes (PMTs), the muon track, and the generated Cherenkov photons in a 3D scene.
*   **Muon Simulation:** Simulates a muon particle traveling through the detector volume.
    *   Initial muon direction (Theta and Phi angles) can be configured via a GUI.
*   **Cherenkov Photon Generation:** Generates Cherenkov photons along the muon's path based on the Cherenkov effect physics (speed of muon > speed of light in the medium).
*   **Photon Propagation:** Simulates the propagation of photons through the water.
*   **PMT Hit Detection:** Detects when photons hit the simulated PMTs.
    *   PMTs change color based on the time of the first photon hit (blue for early, red for late).
*   **2D PMT Display:** Provides a 2D grid representation of the PMT array, mirroring the hit status and color shown in the 3D view.
*   **Interactive Hit Time Chart:** Clicking on a PMT in the 3D view or the 2D grid displays a chart (using Chart.js) showing the distribution of photon hit times for that specific PMT.
*   **Simulation Controls:** A GUI (dat.gui) allows users to:
    *   Set the initial direction of the muon.
    *   Control the simulation speed.
    *   Start and reset the simulation.
*   **Styling:** Uses Bootstrap for basic page styling.

## How to Run

1.  **Prerequisites:** Ensure you have Node.js and npm (or yarn) installed on your system.
2.  **Clone Repository:** Clone this project repository to your local machine (if applicable).
3.  **Install Dependencies:** Open a terminal in the project's root directory and run:
    ```bash
    npm install
    ```
4.  **Run Development Server:** Start the Vite development server:
    ```bash
    npm run dev
    ```
5.  **Open Application:** The terminal will output a local URL (usually `http://localhost:5173` or similar). Open this URL in your web browser to view the simulation.

## Building for Production

To create an optimized build suitable for deployment:

1.  Open a terminal in the project's root directory.
2.  Run the build command:
    ```bash
    npm run build
    ```
3.  This will create a `dist` directory containing the optimized static assets (HTML, CSS, JavaScript).
4.  Deploy the contents of the `dist` directory to your web server or hosting platform.