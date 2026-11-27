// WebGL passes ported from the local Flow Lab canvas app.
export function flowShaders(shaderFloat: string) {
const vertex = `
attribute vec2 position;
varying ${shaderFloat} vec2 uv;
void main(){ uv = position * 0.5 + 0.5; gl_Position = vec4(position,0.,1.); }
`;
const fragment = `
precision ${shaderFloat} float;
varying ${shaderFloat} vec2 uv;
uniform sampler2D image;
uniform float time, strength, scale, aspect, compare;
uniform float rotation, swirl, ripple, chromatic;
uniform float wave, pixelate, halftone, grain, vignette;
uniform vec2 geometry, texel;
uniform vec4 tone;
float hash(vec2 p){
  p = mod(p, 289.0);
  return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);
}
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
             mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
}
float fbm(vec2 p){
  float value=0.; float amplitude=.55;
  mat2 rot=mat2(.8,.6,-.6,.8);
  for(int i=0;i<4;i++){
    value+=amplitude*noise(p);
    p=rot*p*2.03+vec2(7.1,3.7); amplitude*=.5;
  }
  return value;
}
vec2 rotate(vec2 p, float angle){
  float c=cos(angle), s=sin(angle);
  return mat2(c,s,-s,c)*p;
}
// This pass knows nothing about the panels: all effects sample one composite.
vec2 mirrorUv(vec2 p){ return 1.-abs(mod(p,2.)-1.); }
vec4 sampleImage(vec2 p){ return texture2D(image,mirrorUv(p)); }
void main(){
  if(compare>.5){ gl_FragColor=texture2D(image,uv); return; }
  vec2 ratio=vec2(aspect,1.);
  vec2 center=(uv-.5)*ratio;
  // Rotate the FILTER domain, not the source UV. Transform only the resulting
  // displacement vectors back to image space independently of picture rotation.
  vec2 field=rotate(center,rotation);
  float radius=length(field);
  float twist=swirl*5.*exp(-radius*radius*4.)*(1.+.15*sin(time*.7));
  vec2 displacement=rotate(field,twist)-field;
  displacement+=field*geometry.x*.9*radius*radius/(1.+radius*radius);
  displacement+=field/max(radius,.0001)*sin(radius*scale*16.-time*3.)*ripple*.045;
  displacement.x+=sin(field.y*scale*12.-time*2.)*wave*.065;
  if(pixelate>0.){
    float blockSize=mix(.0015,.07,pixelate);
    displacement+=(floor(field/blockSize)+.5)*blockSize-field;
  }
  if(strength>0.){
    vec2 p=(field+vec2(.5))*scale;
    vec2 drift=vec2(time*.17,-time*.12);
    vec2 q=vec2(fbm(p+drift),fbm(p+vec2(5.2,1.3)-drift));
    vec2 flow=vec2(fbm(p+2.8*q+drift),fbm(p+2.8*q+vec2(8.3,2.8)-drift));
    displacement+=(flow-.5)*strength*.32;
  }
  vec2 sampleUv=uv+rotate(displacement,-rotation)/ratio;
  vec2 split=rotate(vec2(chromatic*.025,0.),-rotation)/ratio;
  vec4 color=sampleImage(sampleUv);
  if(chromatic>0.){
    color.r=sampleImage(sampleUv+split).r;
    color.b=sampleImage(sampleUv-split).b;
  }
  if(geometry.y>0.){
    vec3 neighbours=(sampleImage(sampleUv+vec2(texel.x,0.)).rgb+
      sampleImage(sampleUv-vec2(texel.x,0.)).rgb+
      sampleImage(sampleUv+vec2(0.,texel.y)).rgb+
      sampleImage(sampleUv-vec2(0.,texel.y)).rgb)*.25;
    color.rgb+=(color.rgb-neighbours)*geometry.y*2.;
  }
  color.rgb*=exp2(tone.x);
  color.rgb=(color.rgb-.5)*(1.+tone.y)+.5;
  float luma=dot(color.rgb,vec3(.299,.587,.114));
  color.rgb=mix(vec3(luma),color.rgb,1.+tone.z);
  color.rgb+=vec3(.12,0.,-.12)*tone.w;
  if(halftone>0.){
    vec2 cell=fract(field*(45.+scale*8.))-.5;
    float luminance=clamp(dot(color.rgb,vec3(.299,.587,.114)),0.,1.);
    float dotRadius=sqrt(1.-luminance)*.65;
    float paper=smoothstep(dotRadius-.025,dotRadius+.025,length(cell));
    color.rgb=mix(color.rgb,mix(vec3(.06),vec3(.95,.93,.87),paper),halftone);
  }
  if(grain>0.){
    float speckle=hash(floor(gl_FragCoord.xy)+vec2(floor(time*12.),17.));
    color.rgb+=(speckle-.5)*grain*.35;
  }
  float edge=smoothstep(.18,.7,length(uv-.5));
  color.rgb*=1.-edge*vignette*.85;
  gl_FragColor=vec4(clamp(color.rgb,0.,1.),color.a);
}
`;

// Pass 1: composite the three independently rotated source strips. In free
// mode the strip mask rotates WITH the image instead of clipping at screen thirds.
const compositionFragment = `
precision ${shaderFloat} float;
varying ${shaderFloat} vec2 uv;
uniform sampler2D image;
uniform float aspect, splitMode, allowOverflow;
uniform vec3 imageRotations;
uniform vec2 texel;
vec2 sourceUv(float angle,float pivotX){
  if(abs(angle)<.000001) return uv;
  vec2 ratio=vec2(aspect,1.), pivot=vec2(pivotX,.5);
  float c=cos(angle),s=sin(angle);
  return mat2(c,s,-s,c)*((uv-pivot)*ratio)/ratio+pivot;
}
vec4 readSource(vec2 p){ return texture2D(image,1.-abs(mod(p,2.)-1.)); }
vec4 overStrip(vec4 background,float angle,float left,float right,float pivotX){
  // All layers remain present at zero and at a full turn. Angle-dependent
  // visibility used to pop an entire overlap region on/off for one frame.
  vec2 p=sourceUv(angle,pivotX);
  vec2 edge=texel*.75*(abs(cos(angle))+abs(sin(angle)));
  float coverage=smoothstep(left-edge.x,left+edge.x,p.x)*
    (1.-smoothstep(right-edge.x,right+edge.x,p.x))*
    smoothstep(-edge.y,edge.y,p.y)*(1.-smoothstep(1.-edge.y,1.+edge.y,p.y));
  vec4 layer=readSource(p);
  float alpha=coverage*layer.a;
  return vec4(mix(background.rgb,layer.rgb,alpha),alpha+background.a*(1.-alpha));
}
void main(){
  if(splitMode>.5 && allowOverflow>.5){
    // Original backing fills areas uncovered by rotating strips. Layer order
    // is center -> left -> right; fixed screen seams never act as clip masks.
    vec4 color=readSource(uv);
    color=overStrip(color,imageRotations.y,1./3.,2./3.,.5);
    color=overStrip(color,imageRotations.x,0.,1./3.,1./6.);
    color=overStrip(color,imageRotations.z,2./3.,1.,5./6.);
    gl_FragColor=color; return;
  }
  vec2 ratio=vec2(aspect,1.), pivot=vec2(.5);
  float angle=imageRotations.y;
  if(splitMode>.5){
    if(uv.x<1./3.){ pivot.x=1./6.; angle=imageRotations.x; }
    else if(uv.x>=2./3.){ pivot.x=5./6.; angle=imageRotations.z; }
  }
  gl_FragColor=readSource(sourceUv(angle,pivot.x));
}
`;

// Passes 2/3: separable Gaussian on the COMPOSITE, including across seams.
// Working sigma is at most 8 px, so a fixed +/-24 tap window covers 3 sigma.
const blurFragment = `
precision ${shaderFloat} float;
varying ${shaderFloat} vec2 uv;
uniform sampler2D image;
uniform vec2 direction;
uniform float sigma;
void main(){
  vec4 sum=vec4(0.); float total=0.;
  for(int i=-24;i<=24;i++){
    float x=float(i);
    float weight=exp(-.5*x*x/(sigma*sigma));
    sum+=texture2D(image,clamp(uv+direction*x,0.,1.))*weight;
    total+=weight;
  }
  gl_FragColor=sum/total;
}
`;

// Optional optical passes are sequential, so linear and zoom blur genuinely
// compose rather than replacing one another. Both process the whole image.
const opticalFragment = `
precision ${shaderFloat} float;
varying ${shaderFloat} vec2 uv;
uniform sampler2D image;
uniform vec2 direction;
uniform vec2 resolution;
uniform float radial;
void main(){
  vec4 sum=vec4(0.); float total=0.;
  if(radial>0.){
    // Deterministic midpoint integration. Mip bias prefilters footprints wider
    // than one output pixel instead of point-sampling moving color edges.
    float footprint=max(1.,length((uv-.5)*resolution)*radial/64.);
    float bias=log2(footprint);
    for(int i=0;i<64;i++){
      float t=(float(i)+.5)/64.;
      float weight=1.05-abs(t*2.-1.);
      vec2 p=uv-(uv-.5)*radial*t;
      sum+=texture2D(image,clamp(p,0.,1.),bias)*weight;
      total+=weight;
    }
  }else{
    for(int i=-8;i<=8;i++){
      float t=float(i)/8.;
      float weight=1.05-abs(t);
      sum+=texture2D(image,clamp(uv+direction*t,0.,1.))*weight;
      total+=weight;
    }
  }
  gl_FragColor=sum/total;
}
`;

// WebGL 1 requires power-of-two textures for mipmaps. UV-space resampling
// preserves the image aspect; the texture is private to the radial blur pass.
const copyFragment = `
precision ${shaderFloat} float;
varying ${shaderFloat} vec2 uv;
uniform sampler2D image;
void main(){ gl_FragColor=texture2D(image,uv); }
`;
  return { vertex, fragment, compositionFragment, blurFragment, opticalFragment, copyFragment };
}
