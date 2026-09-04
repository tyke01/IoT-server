# AI across IoT sectors

What AI actually does in each field where IoT is deployed, what data it needs, and
how honest a version of it you can demonstrate with one DHT22.

The last column is the point. "Dummy data" is a weaker demo than most people assume
is available to them, because a temperature and humidity sensor already produces the
real inputs for several real decisions.

---

## Your DHT22 is not dummy data

Before the sectors, the thing worth knowing.

Temperature and humidity together determine **vapour pressure deficit**, which is how
hard the air pulls water out of a leaf. It drives irrigation scheduling, greenhouse
ventilation, and drying. Growers act on it directly.

They also determine **dew point**, the temperature at which that air condenses.
Condensation drives fungal disease, mould in buildings, corrosion, and spoilage in
storage.

`src/agent/derived.ts` computes both. From one of your own readings:

```
T=24.9C  RH=60.5%  ->  VPD 1.24 kPa   dew point 16.7C   margin 8.2C
"VPD is in the range usually considered comfortable for growth."
```

Change the conditions and the meaning changes:

| Reading | VPD | Dew point | What it means |
|---|---|---|---|
| 25C, 90% | 0.32 kPa | 23.2C | Nearly saturated. Transpiration slows, fungal risk rises, surfaces only 1.8C above condensing |
| 30C, 40% | 2.55 kPa | 14.9C | Plants lose water fast and may close stomata, so growth stops even with wet soil |
| 18C, 95% | 0.10 kPa | 17.2C | Condensation almost certain |

None of this is machine learning. It is the Tetens and Magnus equations, verified
against reference values: 0.611 kPa at 0C, 2.34 at 20C, 3.17 at 25C.

**That is the most important lesson in this document.** Before reaching for a model,
check whether the quantity you want is already derivable from what you measure.
Breathe on the sensor and watch VPD collapse toward zero, and you have demonstrated a
real agronomic signal with no dataset, no training, and no dummy values.

---

## Agriculture

Where IoT is most deployed and where the economics are clearest, especially at
smallholder scale.

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| Soil moisture, temperature, humidity, rainfall | Irrigation scheduling: how much water, when | Low. Mostly thresholds and evapotranspiration equations |
| Leaf wetness, humidity, temperature | Disease risk forecasting, spray timing | Medium. Established models exist per crop and pathogen |
| Weather plus soil plus growth stage | Yield prediction | High. Needs seasons of labelled harvest data |
| Camera on a boom or drone | Weed and pest identification | High. Labelling is the expensive part |
| Tank levels, pump current | Pump failure prediction, dry-run protection | Low. This is rung 3 from the ladder |

**Demo you can build now:** VPD-based irrigation guidance. High VPD and the plant is
losing water faster than roots supply it. The agent already has
`get_growing_conditions`, so ask it "should I water the greenhouse?" and it answers
from physics rather than a guess.

**What it needs to be real:** a soil moisture probe, which is a 2-dollar analogue
sensor on the same ESP32 and one more field in the contract. That is a genuinely
small step from where this project already is.

---

## Climate and environment

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| PM2.5, PM10, NO2, CO | Calibration against reference stations | Medium. Low-cost sensors drift with humidity, and correcting that is a regression problem with real value |
| Dense low-cost sensor network | Spatial interpolation, filling gaps between sensors | Medium |
| River level, rainfall upstream | Flood early warning | Medium to high. High stakes, so false negatives matter enormously |
| Temperature and humidity across a city | Urban heat island mapping | Low to medium |

**The calibration case deserves attention** because it is the most useful and least
glamorous. Cheap particulate sensors read high in humid air, since water droplets
scatter light like particles do. Training a correction against a reference monitor is
ordinary regression, and it is what makes a network of cheap sensors trustworthy. It
is also exactly the kind of work that gets skipped in favour of a dashboard.

**Demo you can build now:** simulate drift by comparing two mock devices where one
slowly diverges. Rung 3 from the ladder detects it.

---

## Water

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| Flow meters across a network | Leak detection from night-time minimum flow | Low to medium. Often a threshold on a well-chosen statistic |
| Pressure sensors | Burst pipe localisation | High. Needs a hydraulic model of the network |
| Tank level, pump runtime | Demand forecasting, pump scheduling | Medium |
| Turbidity, pH, conductivity | Contamination detection | Medium |

Night-time minimum flow is a good teaching example: consumption should approach zero
at 3am, so whatever is still flowing is leaking. No model at all, just the right
statistic over the right window. Rung 2 territory.

---

## Energy

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| Household current and voltage | Load disaggregation: which appliance is on | High. A genuinely hard signal processing problem |
| Solar output, irradiance, cloud cover | Generation forecasting | Medium. Weather forecasts do most of the work |
| Battery voltage and temperature | State of health, remaining life | Medium to high |
| Inverter telemetry | Fault prediction | Medium. Needs failure history |

Solar generation forecasting is the one most likely to matter in a pay-as-you-go
context: knowing tomorrow's output decides whether a customer can run a fridge.

---

## Cold chain and storage

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| Temperature in transit | Excursion detection and alerting | Low. Threshold plus duration |
| Temperature, humidity, door events | Predicting spoilage before it happens | Medium |
| Compressor current, cycle timing | Refrigeration failure prediction | Medium. Real predictive maintenance, with a real failure mode |

**This is the sector where genuine predictive maintenance is closest to your current
setup.** A compressor has a failure mode, draws current, and changes its cycling
behaviour before it dies. Add a current sensor and you have the missing ingredient
that `ai/README.md` rung 3 says a DHT22 on a desk lacks.

Vaccines and produce both make the stakes concrete.

---

## Manufacturing

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| Vibration at kHz rates | Bearing and gearbox failure prediction | Medium once you have labelled failures, high before |
| Motor current signature | Load and fault detection | Medium |
| Camera on a line | Visual defect inspection | High. Labelling dominates the effort |
| Machine states and cycle times | Throughput optimisation, bottleneck detection | Low. Mostly counting, done well |

The classic predictive maintenance case, and the one that needs everything a DHT22
does not provide: high sample rates, a wearing component, and run-to-failure history.

---

## Buildings

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| Temperature, humidity, CO2, occupancy | HVAC optimisation | Medium. Well-studied, real savings |
| Temperature and humidity | Mould risk from dew point margin | Low. You already compute this |
| Energy use per zone | Anomaly detection on consumption | Low to medium |
| Door, motion, light | Occupancy inference | Medium |

**Demo you can build now:** the dew point margin already in `derived.ts` is the actual
metric building surveyors use for condensation and mould risk. Below about 2 degrees
of margin, surfaces sweat. Your sensor computes it.

---

## Health and clinics

| What is sensed | What AI adds | Honest difficulty |
|---|---|---|
| Fridge temperature | Vaccine viability tracking | Low, high value |
| Room temperature and humidity | Equipment operating envelope monitoring | Low |
| Wearables | Vitals anomaly detection | High, and regulated |

Worth saying explicitly: anything touching patient outcomes carries a duty of care
that a class project should not pretend to meet. Fridge monitoring is a good student
project. Diagnosis is not.

---

## Choosing where AI helps

A pattern runs through every table above.

**The highest-value applications are usually the least sophisticated.** Night-time
minimum flow for leak detection. Duration above a threshold for cold chain. Dew point
margin for mould. Stuck-value detection for a failing sensor. None need a model, all
need someone to have thought about which statistic matters.

**The genuinely hard cases share three traits:** a physical process you cannot
observe directly, a failure or outcome you must wait to label, and consequences
serious enough that being wrong matters. Yield prediction, bearing failure, flood
warning. If your problem has none of those, you probably need arithmetic and a clear
head rather than a model.

**Derived quantities beat both.** VPD, dew point, evapotranspiration, and power factor
are decades-old physics that turn a cheap sensor into a decision. Check for one before
building anything.

---

## Building a sector demo on this project

Everything above can be demonstrated on the existing stack, because the pipeline does
not care what the numbers mean.

1. **Change what the mock publishes.** `scripts/mock-device.ts` generates a random
   walk. Make it produce a daily temperature cycle, or a slow drift, or a step change
   when a door opens. The server, database, API, and agent are unchanged.
2. **Add a derived metric.** `derived.ts` shows the shape: input the measured values,
   output the decision-relevant one.
3. **Add a tool.** One function and one entry in the array, and the agent can answer
   questions about it.
4. **Ask it a sector question.** "Should I water the greenhouse?" or "is there
   condensation risk tonight?"

That last step is where it becomes a demonstration rather than a diagram, and none of
it requires a dataset you do not have.