import { useRef, useEffect, useCallback } from 'react';
import { Engine } from '../simulation/Engine.js';
import { AdaptiveController } from '../ai/AdaptiveController.js';
import { MultiAgentCoordinator } from '../ai/MultiAgentCoordinator.js';
import { loadScenario } from '../city/CityLoader.js';
import { useSimStore } from '../store/simStore.js';
import { useAIStore } from '../store/aiStore.js';
import { useUIStore } from '../store/uiStore.js';
import { useMetricsStore } from '../store/metricsStore.js';

/**
 * useSimulation — Manages engine lifecycle, bridges engine state to Zustand
 */
export function useSimulation() {
  const engineRef = useRef(null);
  const canvasRef = useRef(null);
  const controllerRef = useRef(null);
  const coordinatorRef = useRef(null);

  const updateMetrics = useSimStore(s => s.updateMetrics);
  const pushDecision = useAIStore(s => s.pushDecision);
  const pushReward = useAIStore(s => s.pushReward);
  const updateAIStats = useAIStore(s => s.updateStats);
  const pushSnapshot = useMetricsStore(s => s.pushSnapshot);

  // Initialize engine
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current);
    engineRef.current = engine;

    // AI Controller
    const controller = new AdaptiveController();
    controllerRef.current = controller;
    controller.onDecision = (d) => {
      pushDecision(d);
      pushReward(d.reward || 0);
    };

    // Multi-Agent Coordinator (shadow RL)
    const coordinator = new MultiAgentCoordinator();
    coordinatorRef.current = coordinator;

    // Set AI controller on engine
    engine.aiController = controller;

    // Metrics bridge
    engine.onMetricsUpdate = (data) => {
      updateMetrics(data);
      pushSnapshot({
        vehicleCount: data.vehicleCount,
        avgWait: data.avgWaitTime,
        throughput: data.throughput,
      });

      // Update RL coordinator
      coordinator.update(0.1, engine);
      updateAIStats(coordinator.stats);
    };

    // Load default scenario
    loadScenario('bengaluru', engine).then(() => {
      engine.start();
    }).catch(e => {
      console.error("Failed to load bengaluru scenario, falling back to grid", e);
      loadScenario('generic_grid', engine);
      engine.start();
    });

    return () => {
      engine.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSimSpeed = useCallback((speed) => {
    if (engineRef.current) {
      engineRef.current.setSimSpeed(speed);
      useSimStore.getState().setSimSpeed(speed);
    }
  }, []);

  const setSpawnRate = useCallback((rate) => {
    if (engineRef.current) {
      engineRef.current.setSpawnRate(rate);
      useSimStore.getState().setSpawnRate(rate);
    }
  }, []);

  const setWeather = useCallback((weather) => {
    if (engineRef.current) {
      engineRef.current.setWeather(weather);
      useSimStore.getState().setWeather(weather);
    }
  }, []);

  const setTimeOfDay = useCallback((hour) => {
    if (engineRef.current) {
      engineRef.current.setTimeOfDay(hour);
    }
  }, []);

  const changeScenario = useCallback(async (scenarioId) => {
    if (engineRef.current) {
      await loadScenario(scenarioId, engineRef.current);
      useSimStore.getState().setScenario(scenarioId);
      // Reset AI controller
      if (controllerRef.current) {
        controllerRef.current.decisions = [];
        controllerRef.current.rewardHistory = [];
        controllerRef.current.totalDecisions = 0;
        controllerRef.current.totalReward = 0;
      }
    }
  }, []);

  const triggerAccident = useCallback((severity) => {
    if (engineRef.current) {
      engineRef.current.triggerAccident(severity);
    }
  }, []);

  const handleCanvasClick = useCallback((e) => {
    if (!engineRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const intId = engineRef.current.getIntersectionAt(x, y);
    useUIStore.getState().selectIntersection(intId);
  }, []);

  const setOverlay = useCallback((name, value) => {
    if (engineRef.current) {
      engineRef.current.setOverlay(name, value);
      useUIStore.getState().setOverlay(name, value);
    }
  }, []);

  const getIntersectionData = useCallback((id) => {
    if (engineRef.current) {
      return engineRef.current.getIntersectionData(id);
    }
    return null;
  }, []);

  return {
    canvasRef,
    engineRef,
    setSimSpeed,
    setSpawnRate,
    setWeather,
    setTimeOfDay,
    changeScenario,
    triggerAccident,
    handleCanvasClick,
    setOverlay,
    getIntersectionData,
  };
}
