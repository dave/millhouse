import graphlib from 'graphlib';
import type { Graph as GraphType } from 'graphlib';
import type { AnalyzedIssue } from '../types.js';

const { Graph, alg } = graphlib;

export interface DependencyGraph {
  /**
   * Get all issue numbers that this issue depends on.
   */
  getDependencies(issueNumber: number): number[];

  /**
   * Get all issue numbers that depend on this issue.
   */
  getDependents(issueNumber: number): number[];

  /**
   * Get issues that are ready to start (all dependencies completed).
   */
  getReady(completed: number[]): number[];

  /**
   * Get issues that are blocked (have uncompleted dependencies).
   */
  getBlocked(completed: number[]): number[];

  /**
   * Get topological order of issues.
   */
  getTopologicalOrder(): number[];

  /**
   * Check if the graph is a valid DAG (no cycles).
   */
  isAcyclic(): boolean;

  /**
   * Get cycles if any exist.
   */
  getCycles(): number[][];

  /**
   * Get all issue numbers in the graph.
   */
  getAllIssues(): number[];
}

export class GraphBuilder {
  /**
   * Build a dependency graph from analyzed issues.
   */
  build(issues: AnalyzedIssue[]): DependencyGraph {
    const graph = new Graph({ directed: true });

    // Add all nodes
    for (const issue of issues) {
      graph.setNode(String(issue.number), issue);
    }

    // Add edges (dependency -> dependent)
    for (const issue of issues) {
      for (const dep of issue.dependencies) {
        if (graph.hasNode(String(dep))) {
          // Edge from dependency to dependent (dep must complete before issue)
          graph.setEdge(String(dep), String(issue.number));
        }
      }
    }

    return new DependencyGraphImpl(graph);
  }
}

class DependencyGraphImpl implements DependencyGraph {
  constructor(private graph: GraphType) {}

  getDependencies(issueNumber: number): number[] {
    const predecessors = this.graph.predecessors(String(issueNumber));
    if (!predecessors) return [];
    return predecessors.map((n: string) => parseInt(n, 10));
  }

  getDependents(issueNumber: number): number[] {
    const successors = this.graph.successors(String(issueNumber));
    if (!successors) return [];
    return successors.map((n: string) => parseInt(n, 10));
  }

  getReady(completed: number[]): number[] {
    const completedSet = new Set(completed.map(String));
    const ready: number[] = [];

    for (const node of this.graph.nodes()) {
      // Skip if already completed
      if (completedSet.has(node)) continue;

      // Check if all dependencies are completed
      const deps = this.graph.predecessors(node) || [];
      const allDepsCompleted = deps.every((d: string) => completedSet.has(d));

      if (allDepsCompleted) {
        ready.push(parseInt(node, 10));
      }
    }

    return ready;
  }

  getBlocked(completed: number[]): number[] {
    const completedSet = new Set(completed.map(String));
    const blocked: number[] = [];

    for (const node of this.graph.nodes()) {
      // Skip if already completed
      if (completedSet.has(node)) continue;

      // Check if any dependency is not completed
      const deps = this.graph.predecessors(node) || [];
      const hasPendingDeps = deps.some((d: string) => !completedSet.has(d));

      if (hasPendingDeps) {
        blocked.push(parseInt(node, 10));
      }
    }

    return blocked;
  }

  getTopologicalOrder(): number[] {
    try {
      const sorted = alg.topsort(this.graph);
      return sorted.map((n: string) => parseInt(n, 10));
    } catch {
      // Graph has cycles, return empty
      return [];
    }
  }

  isAcyclic(): boolean {
    return alg.isAcyclic(this.graph);
  }

  getCycles(): number[][] {
    const tarjan = alg.tarjan(this.graph);
    // tarjan returns SCCs; cycles are SCCs with more than 1 node
    return tarjan
      .filter((scc: string[]) => scc.length > 1)
      .map((scc: string[]) => scc.map((n: string) => parseInt(n, 10)));
  }

  getAllIssues(): number[] {
    return this.graph.nodes().map((n: string) => parseInt(n, 10));
  }
}
