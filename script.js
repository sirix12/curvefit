// State
const state = {
    data: [],
    chart: null,
    config: {
        title: 'Experiment Data',
        xLabel: 'X Axis',
        yLabel: 'Y Axis',
        fitType: 'optimal'
    }
};

// DOM Elements
const els = {
    inputX: document.getElementById('inputX'),
    inputY: document.getElementById('inputY'),
    addBtn: document.getElementById('addBtn'),
    clearBtn: document.getElementById('clearBtn'),
    dataBody: document.getElementById('dataBody'),
    // Configuration inputs removed
    fitSelector: document.getElementById('fitSelector'), // New Container
    fitOptions: document.querySelectorAll('.fit-option'), // Buttons
    axisStartX: document.getElementById('axisStartX'),
    axisStartY: document.getElementById('axisStartY'),
    // scalingMode removed (now radio)
    customScaleSection: document.getElementById('customScaleSection'), // New
    autoScaleSection: document.getElementById('autoScaleSection'), // New
    customScaleX: document.getElementById('customScaleX'),
    customScaleY: document.getElementById('customScaleY'),
    scaleLandscape: document.getElementById('scaleLandscape'),
    scalePortrait: document.getElementById('scalePortrait'),
    scaleLandscapeContainer: document.getElementById('scaleLandscapeContainer'),
    scalePortraitContainer: document.getElementById('scalePortraitContainer'),
    equationDisplay: document.getElementById('equationDisplay'),
    r2Display: document.getElementById('r2Display'),
    ctx: document.getElementById('curveChart').getContext('2d')
};

// --- Regression Logic ---

const Statistics = {
    sum: (arr) => arr.reduce((a, b) => a + b, 0),
    mean: (arr) => arr.reduce((a, b) => a + b, 0) / arr.length,

    // Calculate R² (Coefficient of Determination)
    calculateR2: (actualPoints, predictFn) => {
        if (actualPoints.length < 2) return 0;
        const ys = actualPoints.map(p => p.y);
        const yMean = Statistics.mean(ys);

        const ssTot = ys.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
        const ssRes = actualPoints.reduce((sum, p) => sum + Math.pow(p.y - predictFn(p.x), 2), 0);

        return 1 - (ssRes / ssTot);
    }
};

const Fits = {
    linear: (data) => {
        // y = mx + c
        const n = data.length;
        const sumX = Statistics.sum(data.map(p => p.x));
        const sumY = Statistics.sum(data.map(p => p.y));
        const sumXY = Statistics.sum(data.map(p => p.x * p.y));
        const sumXX = Statistics.sum(data.map(p => p.x * p.x));

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        const predict = (x) => slope * x + intercept;
        return {
            predict,
            equation: `y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}`,
            r2: Statistics.calculateR2(data, predict),
            type: 'linear'
        };
    },

    exponential: (data) => {
        // y = ae^(bx)  => ln(y) = ln(a) + bx
        // Use linear regression on (x, ln(y))
        // Filter out y <= 0
        const validData = data.filter(p => p.y > 0);
        if (validData.length < 2) return null;

        const transformed = validData.map(p => ({ x: p.x, y: Math.log(p.y) }));
        const linFit = Fits.linear(transformed);

        // linFit slope = b, linFit intercept = ln(a)
        // equation used locally for parsing, but we reconstruct for final
        // slope string from linear fit is "mx + c" logic

        // Re-extract m and c from the linear calculation to be safe, or just call linear again
        const n = transformed.length;
        const sumX = Statistics.sum(transformed.map(p => p.x));
        const sumY = Statistics.sum(transformed.map(p => p.y));
        const sumXY = Statistics.sum(transformed.map(p => p.x * p.y));
        const sumXX = Statistics.sum(transformed.map(p => p.x * p.x));

        const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const lnA = (sumY - b * sumX) / n;
        const a = Math.exp(lnA);

        const predict = (x) => a * Math.exp(b * x);
        const sign = b >= 0 ? '' : ''; // b includes sign

        return {
            predict,
            equation: `y = ${a.toFixed(4)}e^(${b.toFixed(4)}x)`,
            r2: Statistics.calculateR2(validData, predict),
            type: 'exponential'
        };
    },

    logarithmic: (data) => {
        // y = a + b*ln(x)
        // Linear regression on (ln(x), y)
        // Filter x <= 0
        const validData = data.filter(p => p.x > 0);
        if (validData.length < 2) return null;

        const transformed = validData.map(p => ({ x: Math.log(p.x), y: p.y }));

        const n = transformed.length;
        const sumX = Statistics.sum(transformed.map(p => p.x)); // this is sum(ln(x))
        const sumY = Statistics.sum(transformed.map(p => p.y));
        const sumXY = Statistics.sum(transformed.map(p => p.x * p.y)); // sum(ln(x)*y)
        const sumXX = Statistics.sum(transformed.map(p => p.x * p.x)); // sum(ln(x)^2)

        const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const a = (sumY - b * sumX) / n;

        const predict = (x) => a + b * Math.log(x);

        return {
            predict,
            equation: `y = ${a.toFixed(4)} + ${b.toFixed(4)} * ln(x)`,
            r2: Statistics.calculateR2(validData, predict),
            type: 'logarithmic'
        };
    },

    saturation: (data) => {
        // Michaelis-Menten: y = (Vmax * x) / (Km + x)
        // Linearization (Lineweaver-Burk): 1/y = (Km/Vmax) * (1/x) + (1/Vmax)
        // Let Y' = 1/y, X' = 1/x
        // Y' = m * X' + c
        // where m = Km/Vmax, c = 1/Vmax
        // So Vmax = 1/c, Km = m * Vmax

        // Filter out x=0 or y=0 to avoid infinity
        const validData = data.filter(p => p.x !== 0 && p.y !== 0);
        if (validData.length < 2) return null;

        const transformed = validData.map(p => ({ x: 1 / p.x, y: 1 / p.y }));
        const linFit = Fits.linear(transformed);

        // Extract parameters from linear fit
        // The linear fit returns 'slope' (m) and 'intercept' (c) roughly, but we need to re-calc or parse string?
        // Actually Fits.linear doesn't return raw slope/intercept. Let's direct calc.

        const n = transformed.length;
        const sumX = Statistics.sum(transformed.map(p => p.x));
        const sumY = Statistics.sum(transformed.map(p => p.y));
        const sumXY = Statistics.sum(transformed.map(p => p.x * p.y));
        const sumXX = Statistics.sum(transformed.map(p => p.x * p.x));

        const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const c = (sumY - m * sumX) / n;

        // Avoid divide by zero if c is 0
        if (Math.abs(c) < 1e-10) return null;

        const Vmax = 1 / c;
        const Km = m * Vmax;

        const predict = (x) => (Vmax * x) / (Km + x);

        return {
            predict,
            equation: `y = (${Vmax.toFixed(4)}x) / (${Km.toFixed(4)} + x)`,
            r2: Statistics.calculateR2(validData, predict),
            type: 'saturation'
        };
    }
};

const getBestFit = (data, type) => {
    if (data.length < 2) return null;

    if (type === 'optimal') {
        const fits = [
            Fits.linear(data),
            Fits.exponential(data),
            Fits.logarithmic(data),
            Fits.saturation(data)
        ].filter(f => f !== null);

        if (fits.length === 0) return Fits.linear(data); // Fallback

        // Sort by R2 descending
        return fits.sort((a, b) => b.r2 - a.r2)[0];
    } else if (type === 'linear') {
        return Fits.linear(data);
    } else if (type === 'exponential') {
        return Fits.exponential(data);
    } else if (type === 'logarithmic') {
        return Fits.logarithmic(data);
    } else if (type === 'saturation') {
        return Fits.saturation(data);
    }
    return null;
};

// --- A4 Scale Logic ---
const ScaleCalc = {
    // Standard steps for graph paper: 1, 2, 5, 10, 20...
    getStandardScale: (range, availableCm) => {
        if (range === 0) return 0;

        // Raw units per cm needed to fit
        const rawUnitsPerCm = range / availableCm;

        // Find next largest standard unit
        // Steps: 1, 2, 5 * 10^k
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawUnitsPerCm)));
        const normalized = rawUnitsPerCm / magnitude;

        let step;
        if (normalized <= 1) step = 1;
        else if (normalized <= 2) step = 2;
        else if (normalized <= 5) step = 5;
        else step = 10;

        return step * magnitude;
    },

    // Calculate best fit scales
    calculate: (data, paperWidth, paperHeight, startXOv, startYOv) => {
        if (data.length < 2) return null;

        const xs = data.map(p => p.x);
        const ys = data.map(p => p.y);

        const minX = startXOv !== null && !isNaN(startXOv) ? startXOv : Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = startYOv !== null && !isNaN(startYOv) ? startYOv : Math.min(...ys);
        const maxY = Math.max(...ys);

        const rangeX = maxX - minX;
        const rangeY = maxY - minY;

        if (rangeX <= 0 || rangeY <= 0) return null;

        const scaleX = ScaleCalc.getStandardScale(rangeX, paperWidth);
        const scaleY = ScaleCalc.getStandardScale(rangeY, paperHeight);

        return {
            xPerCm: scaleX,
            yPerCm: scaleY,
            startX: minX,
            startY: minY
        };
    }
};

// --- UI Logic ---

function initChart() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    state.chart = new Chart(els.ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Data Points',
                    data: [],
                    backgroundColor: '#3b82f6',
                    borderColor: '#3b82f6',
                    pointRadius: 6,
                    pointHoverRadius: 8
                },
                {
                    label: 'Best Fit Line',
                    data: [],
                    type: 'line',
                    borderColor: '#10b981',
                    borderWidth: 3,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.4 // Smooth curve
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    mode: 'nearest',
                    intersect: false, // Allow hovering near line
                    callbacks: {
                        label: function (context) {
                            const lines = [];

                            // 1. Real Values
                            if (context.parsed.y !== null) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                label += `Real: (${context.parsed.x.toFixed(2)}, ${context.parsed.y.toFixed(2)})`;
                                lines.push(label);

                                // 2. Scaled Values
                                if (state.lastScale) {
                                    let sX, sY, startX, startY;
                                    const mode = state.lastScale.mode;
                                    const orientation = state.lastScale.orientation;

                                    if (mode === 'custom' && state.lastScale.custom.active) {
                                        sX = state.lastScale.custom.xPerCm;
                                        sY = state.lastScale.custom.yPerCm;
                                        startX = state.lastScale.custom.startX;
                                        startY = state.lastScale.custom.startY;
                                        const orientLabel = orientation === 'landscape' ? 'Landscape' : 'Portrait';
                                        lines.push(`Distance (Custom - ${orientLabel}):`);
                                    } else {
                                        // Use selected orientation for Auto
                                        const scaleData = orientation === 'landscape'
                                            ? state.lastScale.landscape
                                            : state.lastScale.portrait;
                                        if (scaleData) {
                                            sX = scaleData.xPerCm;
                                            sY = scaleData.yPerCm;
                                            startX = scaleData.startX;
                                            startY = scaleData.startY;
                                            const orientLabel = orientation === 'landscape' ? 'Landscape' : 'Portrait';
                                            lines.push(`Distance (A4 ${orientLabel}):`);
                                        }
                                    }

                                    if (sX && sY) {
                                        const distX = (context.parsed.x - startX) / sX;
                                        const distY = (context.parsed.y - startY) / sY;
                                        lines.push(`  X: ${distX.toFixed(2)} cm`);
                                        lines.push(`  Y: ${distY.toFixed(2)} cm`);
                                    }
                                }
                            }
                            return lines;
                        }
                    }
                },
                title: {
                    display: true,
                    text: state.config.title,
                    font: { size: 18, weight: 'bold' },
                    color: '#f8fafc',
                    padding: 20
                },
                legend: {
                    labels: { color: '#f8fafc' }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: { display: true, text: state.config.xLabel, color: '#94a3b8' },
                    grid: { color: 'rgba(148, 163, 184, 0.1)' }
                },
                y: {
                    title: { display: true, text: state.config.yLabel, color: '#94a3b8' },
                    grid: { color: 'rgba(148, 163, 184, 0.1)' }
                }
            }
        }
    });
}

function updateTable() {
    els.dataBody.innerHTML = '';
    state.data.forEach((p, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${p.x}</td>
            <td>${p.y}</td>
            <td><button class="btn-del" onclick="removePoint(${index})">×</button></td>
        `;
        els.dataBody.appendChild(row);
    });
}

function updateCalculation() {
    // 1. Update Chart Data Points
    state.chart.data.datasets[0].data = state.data;

    // 2. Calculate Fit
    if (state.data.length >= 2) {
        const fit = getBestFit(state.data, state.config.fitType);

        if (fit) {
            // Display Stats
            els.equationDisplay.textContent = fit.equation;
            els.r2Display.textContent = fit.r2.toFixed(4);

            // Generate Line Points
            const xs = state.data.map(p => p.x);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const range = maxX - minX || 1;
            const step = range / 50; // 50 points for smoothness

            const lineData = [];
            // Extend slightly beyond min/max
            const start = minX - (range * 0.1);
            const end = maxX + (range * 0.1);

            for (let x = start; x <= end; x += step) {
                // Handle domain constraints
                if (state.config.fitType === 'logarithmic' && x <= 0) continue;
                if (state.config.fitType === 'saturation' && fit.Km && x === -fit.Km) continue;

                lineData.push({ x: x, y: fit.predict(x) });
            }

            state.chart.data.datasets[1].data = lineData;
        } else {
            // Fit failed (e.g. data incompatible with log/exp)
            els.equationDisplay.textContent = "Invalid Data for Fit";
            els.r2Display.textContent = "---";
            state.chart.data.datasets[1].data = [];
        }

    } else {
        els.equationDisplay.textContent = "Need >1 point";
        els.r2Display.textContent = "0.000";
        state.chart.data.datasets[1].data = [];
    }

    // 3. Update Chart Config (Titles)
    state.chart.options.plugins.title.text = state.config.title;
    state.chart.options.scales.x.title.text = state.config.xLabel;
    state.chart.options.scales.y.title.text = state.config.yLabel;

    // 4. Update A4 Scales
    const startX = parseFloat(els.axisStartX.value);
    const startY = parseFloat(els.axisStartY.value);
    const sX = isNaN(startX) ? null : startX;
    const sY = isNaN(startY) ? null : startY;

    // Mode Check
    const modeEl = document.querySelector('input[name="scaleMode"]:checked');
    const mode = modeEl ? modeEl.value : 'auto';

    // Orientation Check
    const orientationEl = document.querySelector('input[name="orientation"]:checked');
    const orientation = orientationEl ? orientationEl.value : 'landscape';

    // Toggle Visibility
    if (mode === 'custom') {
        els.customScaleSection.style.display = 'block';
        els.autoScaleSection.style.display = 'none';
    } else {
        els.customScaleSection.style.display = 'none';
        els.autoScaleSection.style.display = 'block';
    }

    // Update visual selection for orientation in auto mode
    if (orientation === 'landscape') {
        els.scaleLandscapeContainer.dataset.selected = 'true';
        els.scalePortraitContainer.dataset.selected = 'false';
    } else {
        els.scaleLandscapeContainer.dataset.selected = 'false';
        els.scalePortraitContainer.dataset.selected = 'true';
    }

    // Custom Scales
    const custX = parseFloat(els.customScaleX.value);
    const custY = parseFloat(els.customScaleY.value);
    const hasCustom = !isNaN(custX) && !isNaN(custY);

    const land = ScaleCalc.calculate(state.data, 26, 16, sX, sY);
    const port = ScaleCalc.calculate(state.data, 16, 26, sX, sY);

    state.lastScale = {
        mode: mode,
        orientation: orientation,
        landscape: land,
        portrait: port,
        custom: hasCustom ? {
            active: true,
            xPerCm: custX,
            yPerCm: custY,
            startX: sX !== null ? sX : (land ? land.startX : 0),
            startY: sY !== null ? sY : (land ? land.startY : 0)
        } : { active: false }
    };

    if (land) {
        els.scaleLandscape.innerHTML = `X: 1cm = ${land.xPerCm} units<br>Y: 1cm = ${land.yPerCm} units`;
        els.scalePortrait.innerHTML = `X: 1cm = ${port.xPerCm} units<br>Y: 1cm = ${port.yPerCm} units`;
    } else {
        els.scaleLandscape.innerHTML = "--";
        els.scalePortrait.innerHTML = "--";
    }

    state.chart.update();
}

function addPoint() {
    const x = parseFloat(els.inputX.value);
    const y = parseFloat(els.inputY.value);

    if (!isNaN(x) && !isNaN(y)) {
        state.data.push({ x, y });
        // Sort data by X for better line rendering if lines were connected point-to-point, 
        // but for scatter it doesn't matter. For regression, order doesn't matter.
        // However, keeping list sorted is nice for the user? Let's just append for now.

        els.inputX.value = '';
        els.inputY.value = '';
        els.inputX.focus();

        updateTable();
        updateCalculation();
    }
}

window.removePoint = (index) => {
    state.data.splice(index, 1);
    updateTable();
    updateCalculation();
};

// Event Listeners
els.addBtn.addEventListener('click', addPoint);
els.inputY.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPoint();
});

els.clearBtn.addEventListener('click', () => {
    state.data = [];
    updateTable();
    updateCalculation();
});

// Config Listeners
const updateConfig = () => {
    // Title/Labels static now
    // state.config.fitType update handled by buttons
    updateCalculation();
};

// Inputs removed
// els.titleInput.addEventListener('input', updateConfig);
// els.xLabelInput.addEventListener('input', updateConfig);
// els.yLabelInput.addEventListener('input', updateConfig);
// els.fitSelect.addEventListener('change', updateConfig);

// Fit Selector UI Logic
els.fitOptions.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all
        els.fitOptions.forEach(b => b.classList.remove('active'));
        // Add to clicked
        btn.classList.add('active');
        // Update state
        state.config.fitType = btn.dataset.value;
        updateCalculation();
    });
});

els.axisStartX.addEventListener('input', updateCalculation);
els.axisStartY.addEventListener('input', updateCalculation);
els.customScaleX.addEventListener('input', updateCalculation);
els.customScaleY.addEventListener('input', updateCalculation);

// Radio Listener for Scale Mode
document.querySelectorAll('input[name="scaleMode"]').forEach(radio => {
    radio.addEventListener('change', updateCalculation);
});

// Radio Listener for Orientation
document.querySelectorAll('input[name="orientation"]').forEach(radio => {
    radio.addEventListener('change', updateCalculation);
});

// Initialize
initChart();
