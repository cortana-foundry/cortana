import { describe, expect, it } from "vitest";

import { buildTonalPplV1 } from "../../tools/fitness/tonal-ppl-v1.ts";

describe("fitness tonal ppl v1", () => {
  it("builds a PPL split from public and observed Tonal movement support", () => {
    const publicCatalog = {
      summary: {
        publicMovementCount: 9,
        metricReadyCount: 9,
        observedCount: 8,
      },
      movements: [
        { title: "Bench Press", movementId: "8edc0211-4594-4e5e-8e1b-b05dfc1d67c7", metricReady: true, publicUrl: "https://tonal.example/bench", pplBucket: "push", muscleGroup: "chest", pattern: "press" },
        { title: "Standing Barbell Overhead Press", movementId: "eabcfa09-599a-4efd-8997-de107832de01", metricReady: true, publicUrl: "https://tonal.example/ohp", pplBucket: "push", muscleGroup: "shoulders", pattern: "press" },
        { title: "Incline Chest Fly", movementId: "f99ab88a-190a-42bb-b145-298b83b39233", metricReady: true, publicUrl: "https://tonal.example/fly", pplBucket: "push", muscleGroup: "chest", pattern: "fly" },
        { title: "Barbell Bent Over Row", movementId: "ec9edd5f-4745-45b7-b78b-b7368839ca38", metricReady: true, publicUrl: "https://tonal.example/row", pplBucket: "pull", muscleGroup: "back", pattern: "row" },
        { title: "Neutral Grip Lat Pulldown", movementId: "0c498470-12f9-4b8b-83e8-940e70f7b967", metricReady: true, publicUrl: "https://tonal.example/pulldown", pplBucket: "pull", muscleGroup: "lats", pattern: "pull_down" },
        { title: "Straight Arm Pulldown", movementId: "f94f667d-5fe2-4bf7-b87e-ca705d5b627d", metricReady: true, publicUrl: "https://tonal.example/straight-arm", pplBucket: "pull", muscleGroup: "lats", pattern: "pull_down" },
        { title: "Barbell Front Rack Split Squat", movementId: "c7737825-dd6f-44b4-9b25-6ee66b43d07d", metricReady: true, publicUrl: "https://tonal.example/split-squat", pplBucket: "legs", muscleGroup: "quads", pattern: "lunge" },
        { title: "Barbell RDL", movementId: "ef5f1802-a99e-4e56-b473-32bbf353fb73", metricReady: true, publicUrl: "https://tonal.example/rdl", pplBucket: "legs", muscleGroup: "hamstrings", pattern: "hinge" },
        { title: "Lateral Lunge", movementId: "f8bad1ec-c502-4379-b2f4-e9198245e534", metricReady: true, publicUrl: "https://tonal.example/lunge", pplBucket: "legs", muscleGroup: "glutes", pattern: "lunge" },
        { title: "Lateral Bridge With Row", movementId: "d509c836-0e78-48d5-8daf-3900add72be4", metricReady: true, publicUrl: "https://tonal.example/core", pplBucket: "core", muscleGroup: "core", pattern: "anti_rotation" },
      ],
    } as const;

    const observedCatalog = {
      summary: {
        workoutsSeen: 30,
        latestWorkoutAt: "2026-04-08T10:00:00.000Z",
      },
      movements: [
        { movementId: "8edc0211-4594-4e5e-8e1b-b05dfc1d67c7", canonicalKey: "bench press", sampleTitle: "Bench Press", muscleGroup: "chest", pattern: "press", setCount: 20, workoutCount: 8, avgLoad: 42, avgReps: 8, avgVolume: 670, mapped: true },
        { movementId: "eabcfa09-599a-4efd-8997-de107832de01", canonicalKey: "standing barbell overhead press", sampleTitle: "Standing Barbell Overhead Press", muscleGroup: "shoulders", pattern: "press", setCount: 16, workoutCount: 7, avgLoad: 20, avgReps: 10, avgVolume: 400, mapped: true },
        { movementId: "f99ab88a-190a-42bb-b145-298b83b39233", canonicalKey: "incline chest fly", sampleTitle: "Incline Chest Fly", muscleGroup: "chest", pattern: "fly", setCount: 14, workoutCount: 6, avgLoad: 18, avgReps: 12, avgVolume: 380, mapped: true },
        { movementId: "8571813d-b302-4cbe-a3b5-cc805a046b7d", canonicalKey: "triceps extension", sampleTitle: "Triceps Extension", muscleGroup: "triceps", pattern: "extension", setCount: 15, workoutCount: 6, avgLoad: 36, avgReps: 12, avgVolume: 470, mapped: true },
        { movementId: "9b0b0dad-6f86-4832-9dee-e6eaf4fad8b9", canonicalKey: "overhead triceps extension", sampleTitle: "Overhead Triceps Extension", muscleGroup: "triceps", pattern: "extension", setCount: 12, workoutCount: 5, avgLoad: 28, avgReps: 13, avgVolume: 360, mapped: true },
        { movementId: "ec9edd5f-4745-45b7-b78b-b7368839ca38", canonicalKey: "barbell bent over row", sampleTitle: "Barbell Bent Over Row", muscleGroup: "back", pattern: "row", setCount: 18, workoutCount: 7, avgLoad: 45, avgReps: 8, avgVolume: 620, mapped: true },
        { movementId: "0c498470-12f9-4b8b-83e8-940e70f7b967", canonicalKey: "neutral lat pulldown", sampleTitle: "Neutral Grip Lat Pulldown", muscleGroup: "lats", pattern: "pull_down", setCount: 19, workoutCount: 7, avgLoad: 43, avgReps: 9, avgVolume: 790, mapped: true },
        { movementId: "f94f667d-5fe2-4bf7-b87e-ca705d5b627d", canonicalKey: "barbell straight arm pulldown", sampleTitle: "Straight Arm Pulldown", muscleGroup: "lats", pattern: "pull_down", setCount: 11, workoutCount: 5, avgLoad: 21, avgReps: 12, avgVolume: 455, mapped: true },
        { movementId: "0b5e580d-f813-4f4e-81ae-2ed559f88a93", canonicalKey: "barbell biceps curl", sampleTitle: "Barbell Biceps Curl", muscleGroup: "biceps", pattern: "curl", setCount: 13, workoutCount: 5, avgLoad: 24, avgReps: 9, avgVolume: 365, mapped: true },
        { movementId: "d509c836-0e78-48d5-8daf-3900add72be4", canonicalKey: "lateral bridge w row", sampleTitle: "Lateral Bridge With Row", muscleGroup: "core", pattern: "anti_rotation", setCount: 17, workoutCount: 6, avgLoad: 34, avgReps: 13, avgVolume: 470, mapped: true },
        { movementId: "c7737825-dd6f-44b4-9b25-6ee66b43d07d", canonicalKey: "split squat", sampleTitle: "Barbell Front Rack Split Squat", muscleGroup: "quads", pattern: "lunge", setCount: 22, workoutCount: 8, avgLoad: 25, avgReps: 7, avgVolume: 300, mapped: true },
        { movementId: "ef5f1802-a99e-4e56-b473-32bbf353fb73", canonicalKey: "barbell rdl", sampleTitle: "Barbell RDL", muscleGroup: "hamstrings", pattern: "hinge", setCount: 21, workoutCount: 8, avgLoad: 55, avgReps: 7, avgVolume: 690, mapped: true },
        { movementId: "f8bad1ec-c502-4379-b2f4-e9198245e534", canonicalKey: "resisted lateral lunge", sampleTitle: "Lateral Lunge", muscleGroup: "glutes", pattern: "lunge", setCount: 16, workoutCount: 6, avgLoad: 22, avgReps: 10, avgVolume: 225, mapped: true },
        { movementId: "596e7a05-1086-4045-84fb-2b8a2edc88dd", canonicalKey: "standing chop", sampleTitle: "Standing Chop", muscleGroup: "core", pattern: "rotation", setCount: 10, workoutCount: 5, avgLoad: 19, avgReps: 12, avgVolume: 250, mapped: true },
      ],
    } as const;

    const plan = buildTonalPplV1({ publicCatalog, observedCatalog });

    expect(plan.days.push.movements.map((movement) => movement.title)).toContain("Bench Press");
    expect(plan.days.push.movements.map((movement) => movement.title)).toContain("Triceps Extension");
    expect(plan.days.pull.movements.map((movement) => movement.title)).toContain("Barbell Biceps Curl");
    expect(plan.days.legs.movements.map((movement) => movement.title)).toContain("Barbell Front Rack Split Squat");
    expect(plan.days.legs.movements.map((movement) => movement.title)).toContain("Barbell RDL");

    const curl = plan.days.pull.movements.find((movement) => movement.title === "Barbell Biceps Curl");
    expect(curl?.validationSources).toEqual(["observed_history"]);
  });
});
