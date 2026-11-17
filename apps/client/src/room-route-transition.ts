import { createScrollTransitionLayer } from './scroll-transition-layer';
/** Room fixed positioning is relative to the transformed shell. */
export function createRoomRouteTransition(){return createScrollTransitionLayer('in-room-page','.shell');}
