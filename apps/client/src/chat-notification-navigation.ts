/** A native click only opens the current account's current room; it never joins a room. */
export async function openChatFromNotification(ports:{context:()=>{userId:string;roomId:string}|null;navigate:(roomId:string)=>Promise<unknown>;settle:()=>Promise<unknown>;closeOverlays:()=>void;open:(roomId:string)=>void}){
 const initial=ports.context();if(!initial)return;
 const current=()=>{const value=ports.context();return value?.userId===initial.userId&&value.roomId===initial.roomId;};
 ports.closeOverlays();await ports.navigate(initial.roomId);if(!current())return;
 await ports.settle();if(current())ports.open(initial.roomId);
}
