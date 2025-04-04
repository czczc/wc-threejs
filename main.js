import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'dat.gui';

// --- Constants ---
const WATER_DENSITY = 1000; // kg/m^3
const DETECTOR_MASS = 30000; // kg (30 tons)
const WATER_VOLUME = DETECTOR_MASS / WATER_DENSITY; // m^3
const REFRACTIVE_INDEX = 1.33;
const MUON_BETA = 0.999; // Speed relative to c (close to 1 for relativistic muons)
const CHERENKOV_COS_THETA = 1 / (MUON_BETA * REFRACTIVE_INDEX);
const CHERENKOV_ANGLE = Math.acos(CHERENKOV_COS_THETA); // Radians

const PHOTON_SPEED = (3e8 / REFRACTIVE_INDEX) * 1e-9; // m/ns (scaled for simulation time)
const PHOTON_LIFETIME = 4000; // Simulation steps before removal if not hit
const PHOTONS_PER_STEP = 100; // Number of photons to generate per simulation step
const MUON_STEP_LENGTH = 0.01; // meters per simulation step
const MAX_VISIBLE_PHOTONS = 100000; // Maximum photons to buffer/draw at once
const MAX_TRACK_POINTS = 5000; // Max points for the muon track line buffer

const PMT_ROWS = 10;
const PMTS_PER_ROW = 12;
const PMT_RADIUS = 0.15; // meters

// --- Scene Setup ---
let scene, camera, renderer, controls;
let cylinder, pmtMeshes = [], photonPoints, muonTrackLine;
let photons = []; // Array to hold photon data { position, velocity, lifetime }
let raycaster, pointer; // For click detection
let hitPmts = new Map(); // Map<pmtIndex, { firstHitTime: number, photonCount: number }>

// --- Simulation State ---
let muonPosition = new THREE.Vector3();
let muonDirection = new THREE.Vector3(0, -1, 0); // Initial direction (downwards)
let isSimulating = false;
let simulationTime = 0;
let detectorRadius, detectorHeight;
let simulationStepAccumulator = 0; // Accumulator for fractional steps
let muonTrackPointCount = 0; // Keep track of points added to the track buffer
// maxSimulationTime is no longer needed
// --- GUI ---
let gui;
const simParams = {
    angleTheta: 0, // degrees (Down=0)
    anglePhi: 0,   // degrees (Azimuth)
    runSimulation: startSimulation, // Link button to function
    simulationSpeed: 1.0 // Steps per animation frame
};

init();
animate();

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff); // White background

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(3, 3, 3);
    camera.lookAt(scene.position);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Detector Geometry
    calculateDetectorDimensions();
    createDetectorCylinder();
    createPmts();

    // Photon Geometry (using Points for efficiency)
    // Photon Geometry (using Points for efficiency)
    const photonGeometry = new THREE.BufferGeometry();
    // Pre-allocate buffer
    const positions = new Float32Array(MAX_VISIBLE_PHOTONS * 3);
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage); // Hint for optimization
    photonGeometry.setAttribute('position', positionAttribute);
    photonGeometry.setDrawRange(0, 0); // Initially draw nothing

    const photonMaterial = new THREE.PointsMaterial({
        color: 0x00FFFF, // Cyan color for Cherenkov light
        size: 0.05,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending, // Looks brighter when overlapping
        depthWrite: false // Prevent photons obscuring each other unrealistically
    });
    photonPoints = new THREE.Points(photonGeometry, photonMaterial);
    scene.add(photonPoints);

    // Muon Track Line
    const trackMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 }); // Red track
    const trackGeometry = new THREE.BufferGeometry();
    // Pre-allocate buffer
    const trackPositions = new Float32Array(MAX_TRACK_POINTS * 3);
    const trackPositionAttribute = new THREE.BufferAttribute(trackPositions, 3);
    trackPositionAttribute.setUsage(THREE.DynamicDrawUsage);
    trackGeometry.setAttribute('position', trackPositionAttribute);
    trackGeometry.setDrawRange(0, 0); // Initially draw nothing
    muonTrackLine = new THREE.Line(trackGeometry, trackMaterial);
    scene.add(muonTrackLine);

    // GUI Setup
    createGUI();

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown); // Add click listener

    // Initialize Raycaster
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
}

function calculateDetectorDimensions() {
    // Let's choose a common aspect ratio, Height = 2 * Radius (H=D)
    // V = pi * R^2 * H = pi * R^2 * (2R) = 2 * pi * R^3
    // R = cuberoot(V / (2 * pi))
    detectorRadius = Math.cbrt(WATER_VOLUME / (2 * Math.PI));
    detectorHeight = 2 * detectorRadius;
    console.log(`Detector Dimensions: Radius=${detectorRadius.toFixed(2)}m, Height=${detectorHeight.toFixed(2)}m`);
}

function createDetectorCylinder() {
    const geometry = new THREE.CylinderGeometry(detectorRadius, detectorRadius, detectorHeight, 32, 1, true); // Open ended for visibility
    const material = new THREE.MeshStandardMaterial({
        color: 0x0055aa,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide, // See inside and outside
        metalness: 0.1,
        roughness: 0.5
    });
    cylinder = new THREE.Mesh(geometry, material);
    scene.add(cylinder);

    // Add wireframe for better shape perception
    const wireframeGeometry = new THREE.WireframeGeometry(geometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });
    const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    cylinder.add(wireframe); // Add wireframe as child
}

function createPmts() {
    const pmtGeometry = new THREE.SphereGeometry(PMT_RADIUS, 16, 8); // Simple sphere for PMTs
    const pmtMaterial = new THREE.MeshBasicMaterial({
        color: 0x444444, // Default dark color
        transparent: true,
        opacity: 0.1, // Make unhit PMTs very faint, almost invisible outline
        depthWrite: false // Helps with transparency rendering
    });

    const halfHeight = detectorHeight / 2;
    const angleStep = (2 * Math.PI) / PMTS_PER_ROW;
    const heightStep = detectorHeight / (PMT_ROWS + 1);

    pmtMeshes = []; // Clear previous PMTs if any

    // Wall PMTs
    for (let i = 1; i <= PMT_ROWS; i++) {
        const y = halfHeight - i * heightStep;
        for (let j = 0; j < PMTS_PER_ROW; j++) {
            const angle = j * angleStep;
            const placementRadius = detectorRadius + PMT_RADIUS; // Place center just outside
            const x = placementRadius * Math.cos(angle);
            const z = placementRadius * Math.sin(angle);

            const pmt = new THREE.Mesh(pmtGeometry.clone(), pmtMaterial.clone());
            pmt.position.set(x, y, z);
            // Point PMT towards the center (optional, mostly visual)
            pmt.lookAt(new THREE.Vector3(0, y, 0));
            pmt.userData.pmtIndex = pmtMeshes.length; // Store index on mesh
            scene.add(pmt);
            pmtMeshes.push(pmt);
        }
    }

    // Optional: Add Top/Bottom Cap PMTs (more complex positioning)
    // ... (Code to add PMTs on top/bottom caps if desired) ...

    console.log(`Created ${pmtMeshes.length} PMTs`);
}
function createGUI() {
    gui = new GUI();
    gui.add(simParams, 'angleTheta', 0, 90, 1).name('Muon Theta (Down=0)');
    gui.add(simParams, 'anglePhi', 0, 360, 1).name('Muon Phi (Azimuth)');
    gui.add(simParams, 'simulationSpeed', 0.1, 2, 0.1).name('Sim Speed (Steps/Frame)');
    gui.add(simParams, 'runSimulation').name('Run Simulation');
}



function startSimulation() {
    resetSimulation();
    isSimulating = true;
    simulationTime = 0;

    // Calculate initial muon state based on UI
    const theta = THREE.MathUtils.degToRad(simParams.angleTheta); // Angle from +Y axis
    const phi = THREE.MathUtils.degToRad(simParams.anglePhi);   // Angle around Y axis

    // Convert spherical coordinates (r=1, theta, phi) to Cartesian direction vector
    // Note: Three.js uses Y-up. Theta=0 is often +Z, but here we define it as +Y (downwards).
    // Standard physics spherical: x=r*sin(theta)*cos(phi), y=r*cos(theta), z=r*sin(theta)*sin(phi)
    // Adapting to Y-down (theta=0 is -Y):
    muonDirection.set(
        Math.sin(theta) * Math.cos(phi),
        -Math.cos(theta), // Negative Y for downwards
        Math.sin(theta) * Math.sin(phi)
    ).normalize();

    // Start muon at top center
    muonPosition.set(0, detectorHeight / 2, 0);

    console.log("Starting simulation with direction:", muonDirection);

    // Initialize muon track line starting point in the pre-allocated buffer
    const trackPositions = muonTrackLine.geometry.attributes.position.array;
    trackPositions[0] = muonPosition.x;
    trackPositions[1] = muonPosition.y;
    trackPositions[2] = muonPosition.z;
    muonTrackPointCount = 1; // We have one point now
    muonTrackLine.geometry.setDrawRange(0, muonTrackPointCount);
    muonTrackLine.geometry.attributes.position.needsUpdate = true; // Mark buffer for update
    muonTrackLine.geometry.computeBoundingSphere(); // Update bounds

}

function resetSimulation() {
    isSimulating = false;

    // Reset photons
    photons = [];
    // Reset draw range instead of recreating geometry
    photonPoints.geometry.setDrawRange(0, 0);
    photonPoints.geometry.attributes.position.needsUpdate = true; // Ensure update is registered


    // Reset PMT colors
    hitPmts.clear(); // Clear the map
    // maxSimulationTime reset is no longer needed
    const defaultMaterial = new THREE.MeshBasicMaterial({ color: 0x444444 });
    pmtMeshes.forEach(pmt => {
        // Ensure material exists and reset color
        // Reset material properties for unhit state
        if (!pmt.material) {
            // If material somehow got removed, recreate it (shouldn't happen often)
             pmt.material = new THREE.MeshBasicMaterial({
                color: 0x444444,
                transparent: true,
                opacity: 0.1,
                depthWrite: false
            });
        } else {
            pmt.material.color.set(0x444444);
            pmt.material.opacity = 0.1; // Reset to faint outline
            pmt.material.transparent = true;
            pmt.material.needsUpdate = true; // Important for material changes
        }
    });

    // Reset muon track line by resetting the count and draw range
    muonTrackPointCount = 0;
    muonTrackLine.geometry.setDrawRange(0, 0);
    muonTrackLine.geometry.attributes.position.needsUpdate = true; // Ensure update is registered
    muonTrackLine.geometry.computeBoundingSphere(); // Reset bounds

    console.log("Simulation reset.");
}

function generateCherenkovPhotons() {
    if (!isSimulating) return;

    const muonDir = muonDirection;
    const emissionPoint = muonPosition;

    for (let i = 0; i < PHOTONS_PER_STEP; i++) {
        // 1. Generate a random direction perpendicular to muonDir
        let perpVec;
        if (Math.abs(muonDir.y) > 0.99) { // Handle case where muon is nearly vertical
             perpVec = new THREE.Vector3(1, 0, 0);
        } else {
             perpVec = new THREE.Vector3(0, 1, 0).cross(muonDir).normalize();
        }

        // 2. Rotate this perpendicular vector randomly around muonDir
        const randomAngle = Math.random() * 2 * Math.PI;
        const axisAngle = new THREE.Quaternion().setFromAxisAngle(muonDir, randomAngle);
        perpVec.applyQuaternion(axisAngle);

        // 3. Create the photon direction vector
        // Start with the muon direction, scaled by cos(theta_c)
        const photonDir = muonDir.clone().multiplyScalar(CHERENKOV_COS_THETA);
        // Add the perpendicular component, scaled by sin(theta_c)
        photonDir.add(perpVec.multiplyScalar(Math.sin(CHERENKOV_ANGLE)));
        photonDir.normalize(); // Ensure it's a unit vector

        // Add photon data
        photons.push({
            position: emissionPoint.clone(),
            velocity: photonDir.multiplyScalar(PHOTON_SPEED), // Scale direction by speed
            lifetime: PHOTON_LIFETIME
        });
    }
}

function updatePhotons(deltaTime) { // deltaTime assumed to be ~1 simulation step
    const currentPhotonPositions = [];
    const nextPhotons = [];

    for (let i = 0; i < photons.length; i++) {
        const p = photons[i];

        // Update position
        p.position.addScaledVector(p.velocity, deltaTime); // deltaTime is effectively 1 simulation step here
        p.lifetime -= 1;

        // Check boundaries & lifetime
        const withinCylinder =
            p.position.y >= -detectorHeight / 2 && p.position.y <= detectorHeight / 2 &&
            (p.position.x * p.position.x + p.position.z * p.position.z) <= detectorRadius * detectorRadius;

        if (p.lifetime <= 0 || !withinCylinder) {
            continue; // Remove photon
        }

        // Check for PMT hits (simple distance check)
        let hit = false;
        for (let j = 0; j < pmtMeshes.length; j++) {
            const pmt = pmtMeshes[j];
            if (p.position.distanceTo(pmt.position) < PMT_RADIUS * 1.5) { // थोड़ा बड़ा त्रिज्या वाला जांच
                const hitData = hitPmts.get(j);
                // Removed duplicate declaration of hitData
                if (!hitData) { // First hit for this PMT
                    const hitTime = simulationTime;
                    hitPmts.set(j, { firstHitTime: hitTime, photonCount: 1 });

                    // --- Calculate color immediately based on fixed scale ---
                    const minTime = 10;
                    const maxTime = 200;
                    const midTime = (minTime + maxTime) / 2;
                    const blue = new THREE.Color(0x0000ff);
                    const yellow = new THREE.Color(0xffff00);
                    const red = new THREE.Color(0xff0000);
                    let color = new THREE.Color();

                    if (hitTime <= minTime) {
                        color.copy(blue);
                    } else if (hitTime >= maxTime) {
                        color.copy(red);
                    } else {
                        if (hitTime <= midTime) { // Blue to Yellow
                            const t = (hitTime - minTime) / (midTime - minTime);
                            color.lerpColors(blue, yellow, t);
                        } else { // Yellow to Red
                            const t = (hitTime - midTime) / (maxTime - midTime);
                            color.lerpColors(yellow, red, t);
                        }
                    }
                    // --- End color calculation ---

                    // Apply color and make opaque
                    if (!pmt.material) {
                        pmt.material = new THREE.MeshBasicMaterial({ color: color, opacity: 1, transparent: false });
                    } else {
                        pmt.material.color.set(color);
                        pmt.material.opacity = 1;
                        pmt.material.transparent = false;
                        pmt.material.needsUpdate = true;
                    }
                } else { // Subsequent hit for this PMT
                    hitData.photonCount += 1;
                    hitPmts.set(j, hitData); // Update map entry
                }
                hit = true;
                break; // Photon is absorbed by the PMT
            }
        }

        if (!hit) {
            currentPhotonPositions.push(p.position.x, p.position.y, p.position.z);
            nextPhotons.push(p); // Keep photon for next frame
        }
    }

    photons = nextPhotons; // Update the live photon list

    // Update Three.js Points geometry buffer
    const positionAttribute = photonPoints.geometry.attributes.position;
    const positionArray = positionAttribute.array;
    const numPointsToDraw = Math.min(currentPhotonPositions.length / 3, MAX_VISIBLE_PHOTONS); // Ensure we don't exceed buffer

    // Copy data from temporary array to the pre-allocated buffer
    for (let i = 0; i < numPointsToDraw * 3; i++) {
        positionArray[i] = currentPhotonPositions[i];
    }

    // Tell Three.js how many points to draw
    photonPoints.geometry.setDrawRange(0, numPointsToDraw);
    positionAttribute.needsUpdate = true; // Mark buffer for update
    photonPoints.geometry.computeBoundingSphere(); // Important for visibility checks
}

function updateMuon() {
    if (!isSimulating) return;

    // Move muon
    muonPosition.addScaledVector(muonDirection, MUON_STEP_LENGTH);

    // Check if muon is still inside
    const inside = muonPosition.y >= -detectorHeight / 2 - 0.1 && // Add a little buffer
                   muonPosition.y <= detectorHeight / 2 + 0.1 &&
                   (muonPosition.x * muonPosition.x + muonPosition.z * muonPosition.z) <= detectorRadius * detectorRadius;

    if (inside) {
        // Add current position to the track line buffer if space allows
        if (muonTrackPointCount < MAX_TRACK_POINTS) {
            const trackPositions = muonTrackLine.geometry.attributes.position.array;
            const index = muonTrackPointCount * 3;
            trackPositions[index] = muonPosition.x;
            trackPositions[index + 1] = muonPosition.y;
            trackPositions[index + 2] = muonPosition.z;
            muonTrackPointCount++;

            // Update draw range to include the new point
            muonTrackLine.geometry.setDrawRange(0, muonTrackPointCount);
            muonTrackLine.geometry.attributes.position.needsUpdate = true;
            muonTrackLine.geometry.computeBoundingSphere(); // Update bounds
        } else {
            console.warn("Max track points reached. Muon track line will not extend further.");
        }


        // Generate photons at the new position
        generateCherenkovPhotons();
    } else {
        isSimulating = false; // Stop simulation when muon exits
        console.log(`Muon exited detector at time ${simulationTime}.`);
        // updatePmtColorsFinal(); // No longer needed, colors updated immediately
    }

    if (isSimulating) { // Only increment time if still simulating
        simulationTime++;
    }
} // Closing brace for updateMuon

// updatePmtColorsFinal function is no longer needed and has been removed.

// --- Event Handlers ---

function onPointerDown( event ) {

	// Calculate pointer position in normalized device coordinates (-1 to +1) for both components
	pointer.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	pointer.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

    // Update the picking ray with the camera and pointer position
	raycaster.setFromCamera( pointer, camera );

	// Calculate objects intersecting the picking ray
	const intersects = raycaster.intersectObjects( pmtMeshes ); // Only check PMTs

	if ( intersects.length > 0 ) {
        const clickedPmtMesh = intersects[0].object;
        const pmtIndex = clickedPmtMesh.userData.pmtIndex;

        if (pmtIndex !== undefined) {
            const hitData = hitPmts.get(pmtIndex);
            if (hitData) {
                console.log(`PMT Index: ${pmtIndex}, First Hit Time: ${hitData.firstHitTime}, Photons Collected: ${hitData.photonCount}`);
            } else {
                console.log(`PMT Index: ${pmtIndex} was not hit.`);
            }
        }
	}
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    controls.update(); // Only required if controls.enableDamping = true

    // Handle simulation steps with fractional speed
    if (isSimulating) {
        simulationStepAccumulator += simParams.simulationSpeed;
        const stepsToRun = Math.floor(simulationStepAccumulator);

        if (stepsToRun > 0) {
            for (let i = 0; i < stepsToRun; i++) {
                updateMuon(); // This also generates photons if inside
                updatePhotons(1); // Pass a fixed time step (e.g., 1)
                if (!isSimulating) break; // Stop looping if muon exits during steps
            }
            simulationStepAccumulator -= stepsToRun; // Subtract the executed steps
        }
    } else {
         // Still update photons even if simulation stopped (e.g., muon exited)
         // until they fade or hit PMTs
         if (photons.length > 0) {
             updatePhotons(1);
         }
         simulationStepAccumulator = 0; // Reset accumulator when not simulating
    }


    renderer.render(scene, camera);
}