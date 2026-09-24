// Fixtures para los tests de diseños de experimentos IMP-20.

import { EXPERIMENT_DESIGNS } from "../../src/imp20-experiments/designs.mjs";

export function baseDesign() {
  return structuredClone(EXPERIMENT_DESIGNS[0]);
}

export function designWithS5Serial() {
  return structuredClone(EXPERIMENT_DESIGNS.find((design) => design.identity.experimentId === "IMP20-EX-S05-01"));
}

export function designWithDrivers() {
  return structuredClone(EXPERIMENT_DESIGNS.find((design) => design.identity.experimentId === "IMP20-EX-D01-01"));
}

export function designWithZ() {
  return structuredClone(EXPERIMENT_DESIGNS.find((design) => design.identity.experimentId === "IMP20-EX-Z01-01"));
}

export function stripUnknowns(design) {
  design.unknowns = [];
  return design;
}
