import { expect, it } from 'vitest';
import { roomCommentSnap } from '../src/room-comment-snap';

const regular={viewport:640,stageEnd:0,dock:700};
it('returns small gestures to the stage and docks once the distance is met',()=>{
  expect(roomCommentSnap('stage',{...regular,top:80})).toEqual({region:'stage',target:0});
  expect(roomCommentSnap('stage',{...regular,top:160})).toEqual({region:'comments',target:700});
  expect(roomCommentSnap('stage',{...regular,top:900})).toEqual({region:'comments',target:700});
});
it('returns short upward gestures to the comments, but a larger one to the stage',()=>{
  expect(roomCommentSnap('comments',{...regular,top:640})).toEqual({region:'comments',target:700});
  expect(roomCommentSnap('comments',{...regular,top:530})).toEqual({region:'stage',target:0});
});
it('does not trap scrolling within long comments or a taller-than-screen stage',()=>{
  expect(roomCommentSnap('comments',{...regular,top:1400})).toEqual({region:'comments'});
  const short={viewport:260,stageEnd:260,dock:580};
  expect(roomCommentSnap('stage',{...short,top:200})).toEqual({region:'stage'});
  expect(roomCommentSnap('stage',{...short,top:280})).toEqual({region:'stage',target:260});
  expect(roomCommentSnap('stage',{...short,top:330})).toEqual({region:'comments',target:580});
});
