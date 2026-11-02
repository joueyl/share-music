import { PMREMGenerator } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Neutral, locally generated reflections: metallic silver needs more than point highlights. */
export function createStageEnvironment(renderer: WebGLRenderer, scene: Scene) {
 const generator = new PMREMGenerator(renderer);
 const studio = new RoomEnvironment();
 let target;
 try {
  target = generator.fromScene(studio, 0.04);
 } finally {
  studio.dispose();
  generator.dispose();
 }
 const previous = scene.environment;
 const previousIntensity = scene.environmentIntensity;
 scene.environment = target.texture;
 scene.environmentIntensity = 0.8;
 let disposed = false;
 return {
  dispose() {
   if (disposed) return;
   disposed = true;
   if (scene.environment === target.texture) {
    scene.environment = previous;
    scene.environmentIntensity = previousIntensity;
   }
   target.dispose();
  },
 };
}
