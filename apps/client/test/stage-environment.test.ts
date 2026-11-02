import { beforeEach, expect, it, vi } from 'vitest';
import { Scene, Texture } from 'three';
import type { WebGLRenderer } from 'three';
import { createStageEnvironment } from '../src/stage-environment';

const state = vi.hoisted(() => ({
 fromScene: vi.fn(), generatorDispose: vi.fn(), studioDispose: vi.fn(), targetDispose: vi.fn(),
}));
vi.mock('three', async importOriginal => ({
 ...await importOriginal<typeof import('three')>(),
 PMREMGenerator: class {
  fromScene = state.fromScene;
  dispose = state.generatorDispose;
 },
}));
vi.mock('three/examples/jsm/environments/RoomEnvironment.js', () => ({
 RoomEnvironment: class { dispose = state.studioDispose; },
}));
beforeEach(() => vi.resetAllMocks());
function fixture() {
 const scene = new Scene(), texture = new Texture();
 state.fromScene.mockReturnValue({ texture, dispose: state.targetDispose });
 return { scene, texture, renderer: {} as WebGLRenderer };
}
it('adds neutral reflections without replacing the transparent background', () => {
 const { scene, texture, renderer } = fixture();
 const environment = createStageEnvironment(renderer, scene);
 expect(scene.environment).toBe(texture);
 expect(scene.environmentIntensity).toBe(0.8);
 expect(scene.background).toBeNull();
 expect(state.fromScene).toHaveBeenCalledWith(expect.anything(), 0.04);
 expect(state.studioDispose).toHaveBeenCalledOnce();
 expect(state.generatorDispose).toHaveBeenCalledOnce();
 expect(state.targetDispose).not.toHaveBeenCalled();
 environment.dispose();
});
it('restores previous reflections and releases its texture once on unmount', () => {
 const { scene, renderer } = fixture();
 const previous = scene.environment = new Texture();
 scene.environmentIntensity = 0.5;
 const environment = createStageEnvironment(renderer, scene);
 environment.dispose(); environment.dispose();
 expect(scene.environment).toBe(previous);
 expect(scene.environmentIntensity).toBe(0.5);
 expect(state.targetDispose).toHaveBeenCalledOnce();
});
it('does not overwrite a subsequently replaced environment during cleanup', () => {
 const { scene, renderer } = fixture();
 const environment = createStageEnvironment(renderer, scene);
 const replacement = scene.environment = new Texture();
 scene.environmentIntensity = 0.3;
 environment.dispose();
 expect(scene.environment).toBe(replacement);
 expect(scene.environmentIntensity).toBe(0.3);
 expect(state.targetDispose).toHaveBeenCalledOnce();
});
it('cleans up temporary generation resources if baking fails', () => {
 const { scene, renderer } = fixture();
 state.fromScene.mockImplementation(() => { throw new Error('GPU failure'); });
 expect(() => createStageEnvironment(renderer, scene)).toThrow('GPU failure');
 expect(scene.environment).toBeNull();
 expect(state.studioDispose).toHaveBeenCalledOnce();
 expect(state.generatorDispose).toHaveBeenCalledOnce();
});
