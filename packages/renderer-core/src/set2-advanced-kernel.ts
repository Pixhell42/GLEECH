// Generated from set2-advanced.kernel by tooling/generate-advanced-shaders.mjs.
export const ADVANCED_KERNEL_WGSL = `
fn a_Palette(t:f32,ch:f32)->f32 {
var spectral = (0.5 + (0.5 * cos((((t * 6.283185) + (ch * 2.094395)) + a_U(7.0)))));
return mix(mix(a_U((28.0 + ch)),a_U((24.0 + ch)),clamp(t,0.0,1.0)),spectral,a_U(11.0));
}
fn a_Hue(r:f32,g:f32,b:f32,angle:f32,ch:f32)->f32 {
var c = cos(angle);
var s = sin(angle);
var y = (((0.299 * r) + (0.587 * g)) + (0.114 * b));
var i = (((0.596 * r) - (0.274 * g)) - (0.322 * b));
var q = (((0.211 * r) - (0.523 * g)) + (0.312 * b));
var ii = ((i * c) - (q * s));
var qq = ((i * s) + (q * c));
if ((ch == 0.0)) {return clamp(((y + (0.956 * ii)) + (0.621 * qq)),0.0,1.0);}
if ((ch == 1.0)) {return clamp(((y - (0.272 * ii)) - (0.647 * qq)),0.0,1.0);}
return clamp(((y - (1.106 * ii)) + (1.703 * qq)),0.0,1.0);
}
fn a_Lum(u:f32,v:f32)->f32 {
return (((((a_T(u,v,0.0) * 0.2126) + (a_T(u,v,1.0) * 0.7152)) + (a_T(u,v,2.0) * 0.0722))) * a_T(u,v,3.0));
}
fn a_Segment(x:f32,y:f32,ax:f32,ay:f32,bx:f32,by:f32)->f32 {
var dx = (bx - ax);
var dy = (by - ay);
var t = clamp(((((((x - ax)) * dx) + (((y - ay)) * dy))) / max(0.000001,((dx * dx) + (dy * dy)))),0.0,1.0);
return sqrt((((((x - ax) - (dx * t))) * (((x - ax) - (dx * t)))) + ((((y - ay) - (dy * t))) * (((y - ay) - (dy * t))))));
}
fn a_Mandel(x:f32,y:f32,limit:f32)->f32 {
return a_M(x,y,limit);
}
fn a_Safe(x:f32)->f32 {
if ((abs(x) < 0.00001)) {
if ((x < 0.0)) {return -0.00001;}
return 0.00001;
}
return x;
}
fn a_Primitive(ox:f32,oy:f32,oz:f32,dx:f32,dy:f32,dz:f32,r:f32,shape:f32)->f32 {
if ((shape == 2.0)) {
var xa = (((-r - ox)) / a_Safe(dx));
var xb = (((r - ox)) / a_Safe(dx));
var ya = (((-r - oy)) / a_Safe(dy));
var yb = (((r - oy)) / a_Safe(dy));
var za = (((-r - oz)) / a_Safe(dz));
var zb = (((r - oz)) / a_Safe(dz));
var entry = max(max(min(xa,xb),min(ya,yb)),min(za,zb));
var exit = min(min(max(xa,xb),max(ya,yb)),max(za,zb));
if ((exit < max(0.0,entry))) {return 100.0;}
return max(0.0,entry);
}
var a = (((dx * dx) + (dy * dy)) + (dz * dz));
var b = (2.0 * ((((ox * dx) + (oy * dy)) + (oz * dz))));
var cc = ((((ox * ox) + (oy * oy)) + (oz * oz)) - (r * r));
if ((shape == 3.0)) {
a = ((dx * dx) + (dz * dz));
b = (2.0 * (((ox * dx) + (oz * dz))));
cc = (((ox * ox) + (oz * oz)) - (r * r));
}
if ((shape == 4.0)) {
a = (((dx * dx) + (dz * dz)) - ((dy * dy) * 0.25));
b = (2.0 * ((((ox * dx) + (oz * dz)) + ((((r - oy)) * dy) * 0.25))));
cc = (((ox * ox) + (oz * oz)) - ((((r - oy)) * ((r - oy))) * 0.25));
}
var shift = 0.0;
if ((abs(a) > 0.00001)) {
shift = (b / ((-2.0 * a)));
var x = (ox + (dx * shift));
var y = (oy + (dy * shift));
var z = (oz + (dz * shift));
b = (2.0 * ((((x * dx) + (y * dy)) + (z * dz))));
cc = ((((x * x) + (y * y)) + (z * z)) - (r * r));
if ((shape == 3.0)) {
b = (2.0 * (((x * dx) + (z * dz))));
cc = (((x * x) + (z * z)) - (r * r));
}
if ((shape == 4.0)) {
b = (2.0 * ((((x * dx) + (z * dz)) + ((((r - y)) * dy) * 0.25))));
cc = (((x * x) + (z * z)) - ((((r - y)) * ((r - y))) * 0.25));
}
}
var disc = ((b * b) - ((4.0 * a) * cc));
var result = 100.0;
if (((disc >= 0.0) && (abs(a) > 0.00001))) {
var root = sqrt(disc);
var first = (shift + (((b + root)) / ((-2.0 * a))));
var second = (shift + (((b - root)) / ((-2.0 * a))));
for (var i = 0.0;(i < 2.0);i += 1.0) {
var t = first;
if ((i == 1.0)) {t = second;}
if (((t >= 0.0) && (((shape < 3.0) || (abs((oy + (dy * t))) <= r))))) {result = min(result,t);}
}
}
if (((shape >= 3.0) && (abs(dy) > 0.00001))) {
for (var i = 0.0;(i < 2.0);i += 1.0) {
var cap = -r;
if ((i == 1.0)) {cap = r;}
var t = (((cap - oy)) / dy);
var x = (ox + (dx * t));
var z = (oz + (dz * t));
var capRadius = r;
if (((shape == 4.0) && (i == 1.0))) {capRadius = 0.0;}
if (((t >= 0.0) && (((x * x) + (z * z)) <= (capRadius * capRadius)))) {result = min(result,t);}
}
}
return result;
}
fn a_FoilDistance(x:f32,y:f32,z:f32,u:f32,v:f32)->f32 {
var yaw = (a_P(5.0) * 0.0174533);
var pitch = (a_P(12.0) * 0.0174533);
var rx = ((cos(yaw) * x) - (sin(yaw) * z));
var rz = ((sin(yaw) * x) + (cos(yaw) * z));
var ry = ((cos(pitch) * y) - (sin(pitch) * rz));
rz = ((sin(pitch) * y) + (cos(pitch) * rz));
var radius = a_P(4.0);
var distance = (sqrt((((rx * rx) + (ry * ry)) + (rz * rz))) - radius);
if ((a_P(3.0) > 0.0)) {
var q = (sqrt(((rx * rx) + (rz * rz))) - (radius * 0.72));
distance = (sqrt(((q * q) + (ry * ry))) - (radius * 0.22));
if ((a_P(3.0) > 1.0)) {
var q2 = (sqrt(((ry * ry) + (rz * rz))) - (radius * 0.72));
distance = min(distance,(sqrt(((q2 * q2) + (rx * rx))) - (radius * 0.22)));
}
}
var phase = a_U(4.0);
var materialX = ((((((cos(a_U(22.0)) * rx) - (sin(a_U(22.0)) * ry))) * a_P(6.0)) * a_U(2.0)) / 5.0);
var materialY = ((((((sin(a_U(22.0)) * rx) + (cos(a_U(22.0)) * ry))) * a_P(6.0)) * a_U(2.0)) / 5.0);
var folds = (sin(((materialX * 8.0) + phase)) * sin((((materialY * 6.0) - phase) + a_U(7.0))));
var relief = (((a_H(u,v) - 0.5)) * a_P(10.0));
return (distance + (((((folds * a_P(7.0)) + relief)) * radius) * 0.065));
}
fn a_PrimitiveCoverage(ox:f32,oy:f32,oz:f32,dx:f32,dy:f32,dz:f32,r:f32,shape:f32,pixel:f32)->f32 {
if ((shape == 2.0)) {return 1.0;}
var a = (((dx * dx) + (dy * dy)) + (dz * dz));
var b = (2.0 * ((((ox * dx) + (oy * dy)) + (oz * dz))));
if ((shape == 3.0)) {
a = ((dx * dx) + (dz * dz));
b = (2.0 * (((ox * dx) + (oz * dz))));
}
if ((shape == 4.0)) {
a = (((dx * dx) + (dz * dz)) - ((dy * dy) * 0.25));
b = (2.0 * ((((ox * dx) + (oz * dz)) + ((((r - oy)) * dy) * 0.25))));
}
var t = (b / ((-2.0 * a_Safe(a))));
if (((shape >= 3.0) && (abs(dy) > 0.00001))) {
var first = (((-r - oy)) / dy);
var last = (((r - oy)) / dy);
t = clamp(t,min(first,last),max(first,last));
if (((shape == 4.0) && (a < 0.0))) {
var x1 = (ox + (dx * first));
var z1 = (oz + (dz * first));
var x2 = (ox + (dx * last));
var z2 = (oz + (dz * last));
if (((((x1 * x1) + (z1 * z1)) - (r * r)) < ((x2 * x2) + (z2 * z2)))) {t = first;} else {t = last;}
}
}
var x = (ox + (dx * t));
var y = (oy + (dy * t));
var z = (oz + (dz * t));
var gap = (sqrt((((x * x) + (y * y)) + (z * z))) - r);
if ((shape >= 3.0)) {gap = (sqrt(((x * x) + (z * z))) - r);}
if ((shape == 4.0)) {
var radius = (((r - y)) * 0.5);
gap = (((((x * x) + (z * z)) - (radius * radius))) / max(0.00001,sqrt(((((4.0 * x) * x) + ((4.0 * z) * z)) + (radius * radius)))));
}
if (((shape >= 3.0) && (abs(dy) <= 0.00001))) {gap = max(gap,(abs(oy) - r));}
return clamp((0.5 - (gap / max(0.00001,pixel))),0.0,1.0);
}
fn a_Shade0(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var grid = a_P(4.0);
var ux = ((floor((u / grid)) * grid) + (grid * 0.5));
var uy = ((floor((v / grid)) * grid) + (grid * 0.5));
var wx = ((sin(((qy + phase) + (a_N(qx,qy) * 6.0))) * a_P(3.0)) * 0.12);
var wy = ((cos(((qx - phase) + seed)) * a_P(3.0)) * 0.12);
var height = a_H((ux + wx),(uy + wy));
var bands = ((height * a_P(2.0)) + (sin(((qx + qy) + phase)) * a_P(3.0)));
var wave = sin((((bands * 6.283185) + phase) + seed));
coverage = clamp(((((wave - ((1.0 - (a_P(5.0) * 2.0))))) / max(0.03,aa)) + 0.5),0.0,1.0);
tone = height;
if ((a_P(1.0) > 0.0)) {tone = (floor((height * a_P(2.0))) / a_P(2.0));}
sx = (ux + wx);
sy = (uy + wy);
}
{
var hue = (a_P(6.0) * 0.0174533);

if ((hue != 0.0)) {
var r = (mix(a_Palette(tone,0.0),a_T(sx,sy,0.0),a_P(0.0)) * lighting);
var g = (mix(a_Palette(tone,1.0),a_T(sx,sy,1.0),a_P(0.0)) * lighting);
var b = (mix(a_Palette(tone,2.0),a_T(sx,sy,2.0),a_P(0.0)) * lighting);
for (var ch = 0.0;(ch < 3.0);ch += 1.0) {advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),a_Hue(r,g,b,hue,ch),coverage);}
return;
}
}
for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade1(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var flowx = sin((((qy * 0.7) + phase) + seed));
var flowy = cos(((qx * 0.6) - phase));
if ((a_U(23.0) > 0.5)) {
flowx = mix(flowx,a_D(u,v,0.0),a_U(31.0));
flowy = mix(flowy,a_D(u,v,1.0),a_U(31.0));
}
var dx = (flowx * a_P(4.0));
var dy = (flowy * a_P(4.0));
coverage = 0.0;
for (var j = 0.0;(j < 6.0);j += 1.0) {
if ((j >= a_P(6.0))) {break;}
var xx = ((qx + (dx * sin(((qy + j) + phase)))) + (j * 0.37));
var yy = ((qy + (dy * cos(((qx - j) + phase)))) + (j * 0.61));
var cell = floor(xx);
var row = floor((yy * 0.25));
var r = a_R(cell,row,j);
var width = a_P(5.0);
if ((a_P(1.0) == 1.0)) {width = min(0.8,(width * 2.5));}
var dist = abs(((xx - floor(xx)) - 0.5));
var line = clamp(((((width - dist)) / aa) + 0.5),0.0,1.0);
var along = ((yy * 0.25) - floor((yy * 0.25)));
var length = a_P(3.0);
if ((a_P(1.0) == 2.0)) {length = (length * 0.35);}
var taper = clamp((min(along,(length - along)) / max(0.01,((length * a_P(7.0)) * 0.3))),0.0,1.0);
if ((a_P(7.0) == 0.0)) {taper = 1.0;}
if (((r < a_P(2.0)) && (along < length))) {coverage = max(coverage,(line * taper));}
}
sx = (u - (((flowx * a_P(3.0)) * a_P(4.0)) * 0.04));
sy = (v - (((flowy * a_P(3.0)) * a_P(4.0)) * 0.04));
tone = a_N(((qx * 0.15) + (phase * 0.1)),(qy * 0.15));
}
{
var hue = (a_P(6.0) * 0.0174533);
hue = (a_P(8.0) * 0.0174533);
if ((hue != 0.0)) {
var r = (mix(a_Palette(tone,0.0),a_T(sx,sy,0.0),a_P(0.0)) * lighting);
var g = (mix(a_Palette(tone,1.0),a_T(sx,sy,1.0),a_P(0.0)) * lighting);
var b = (mix(a_Palette(tone,2.0),a_T(sx,sy,2.0),a_P(0.0)) * lighting);
for (var ch = 0.0;(ch < 3.0);ch += 1.0) {advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),a_Hue(r,g,b,hue,ch),coverage);}
return;
}
}
for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade2(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var rx = bx;
var ry = by;
var z = (a_Lum(u,v) * a_P(5.0));
if ((a_P(2.0) > 0.0)) {
var r = a_P(3.0);
var rr = ((((bx * bx) + (by * by))) / ((r * r)));
coverage = clamp((((1.0 - rr)) / max(0.01,(a_AA() * 4.0))),0.0,1.0);
z = sqrt(max(0.0,(1.0 - rr)));
rx = (a_ATAN((bx / max(0.001,r)),z) + (a_P(8.0) * 0.0174533));
ry = a_ATAN((by / max(0.001,r)),z);
sx = (0.5 + (rx / 3.141593));
sy = (0.5 + (ry / 3.141593));
lighting = (0.3 + (z * 0.7));
}
var materialX = ((cos(angle) * rx) - (sin(angle) * ry));
var materialY = ((sin(angle) * rx) + (cos(angle) * ry));
var wave = sin((((((((((materialY + (materialX * 0.35)) + (z * a_P(5.0)))) * a_P(4.0)) * a_U(2.0)) / 5.0) * 3.141593) + phase) + seed));
var jitter = (((a_N(((qx * 5.0) + phase),(qy * 5.0)) - 0.5)) * a_P(7.0));
tone = clamp((((wave * 0.5) + 0.5) + jitter),0.0,1.0);
if ((a_P(1.0) > 0.0)) {tone = (floor((tone * 4.0)) / 3.0);}
lighting = (lighting * ((0.3 + clamp(((((0.08 + (a_P(6.0) * 0.32)) - abs(wave))) / max(0.04,aa)),0.0,1.0))));
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade3(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var l = a_Lum(u,v);
var nx = 0.0;
var ny = 0.0;
var nz = 1.0;
if ((a_P(2.0) > 0.0)) {
var yaw = (a_P(8.0) * 0.0174533);
var pitch = (a_P(9.0) * 0.0174533);
var rox = ((cos(yaw) * bx) - (sin(yaw) * (-3.0)));
var rz = ((sin(yaw) * bx) + (cos(yaw) * (-3.0)));
var roy = ((cos(pitch) * by) - (sin(pitch) * rz));
var roz = ((sin(pitch) * by) + (cos(pitch) * rz));
var dx = -sin(yaw);
var dz = cos(yaw);
var dy = (-sin(pitch) * dz);
dz = (cos(pitch) * dz);
var nearest = 100.0;
coverage = 0.0;
for (var j = 0.0;(j < 12.0);j += 1.0) {
if ((j >= a_P(4.0))) {break;}
var cx = ((((a_R(j,0.0,1.0) - 0.5)) * a_P(6.0)) * a_P(13.0));
var cy = ((((a_R(j,0.0,2.0) - 0.5)) * a_P(6.0)) * a_P(14.0));
var cz = ((((a_R(j,0.0,3.0) - 0.5)) * a_P(6.0)) * 0.5);
var rot = (((a_P(7.0) * 0.0174533) + phase) + (a_R(j,0.0,4.0) * 2.0));
var x = (rox - cx);
var y = (roy - cy);
var z = (roz - cz);
var lx = ((cos(rot) * x) - (sin(rot) * z));
var lz = ((sin(rot) * x) + (cos(rot) * z));
var vx = ((cos(rot) * dx) - (sin(rot) * dz));
var vz = ((sin(rot) * dx) + (cos(rot) * dz));
var shape = a_P(3.0);
if ((shape == 0.0)) {shape = (1.0 + floor((a_R(j,0.0,5.0) * 4.0)));}
var size = (a_P(5.0) * ((0.75 + (a_R(j,0.0,6.0) * 0.5))));
var t = a_Primitive(lx,y,lz,vx,dy,vz,size,shape);
var silhouette = a_PrimitiveCoverage(lx,y,lz,vx,dy,vz,size,shape,a_AA());
if ((((shape != 2.0) && (silhouette < 1.0)) && (silhouette > 0.0))) {
var outer = a_Primitive(lx,y,lz,vx,dy,vz,(size + (a_AA() * 2.0)),shape);
if ((t < 100.0)) {t = mix(outer,t,clamp((((silhouette - 0.75)) * 4.0),0.0,1.0));} else {t = outer;}
}
if (((t < nearest) && (silhouette > 0.0))) {
nearest = t;
coverage = silhouette;
var hx = (lx + (vx * t));
var hy = (y + (dy * t));
var hz = (lz + (vz * t));
nx = (hx / size);
ny = (hy / size);
nz = (hz / size);
if ((shape == 2.0)) {
var m = max(max(abs(hx),abs(hy)),abs(hz));
nx = 0.0;
ny = 0.0;
nz = 0.0;
if ((abs(hx) >= (m - 0.0001))) {nx = sign(hx);} else if ((abs(hy) >= (m - 0.0001))) {ny = sign(hy);} else {nz = sign(hz);}
}
if ((shape >= 3.0)) {
if ((abs((abs(hy) - size)) < 0.001)) {
nx = 0.0;
nz = 0.0;
ny = sign(hy);
} else {
ny = 0.0;
if ((shape == 4.0)) {ny = 0.5;}
}
}
var normalX = ((cos(rot) * nx) + (sin(rot) * nz));
var normalZ = ((-sin(rot) * nx) + (cos(rot) * nz));
nx = normalX;
nz = normalZ;
sx = clamp((0.5 + (hx / ((size * 3.0)))),0.0,1.0);
sy = clamp((0.5 + (hy / ((size * 3.0)))),0.0,1.0);
l = (0.5 + (hy / ((size * 4.0))));
}
}
} else {
nx = (((a_Lum((u + 0.005),v) - a_Lum((u - 0.005),v))) * 10.0);
ny = (((a_Lum(u,(v + 0.005)) - a_Lum(u,(v - 0.005)))) * 10.0);
}
var light = (a_P(12.0) * 0.0174533);
lighting = mix(1.0,clamp((((0.45 + ((nx * cos(light)) * 0.35)) - ((ny * sin(light)) * 0.35)) + (abs(nz) * 0.3)),0.1,1.0),a_P(11.0));
var hatch = abs(sin((((qx * 6.283185) + phase) + seed)));
if ((a_P(1.0) > 0.0)) {hatch = min(hatch,abs(sin(((qy * 6.283185) - phase))));}
if ((a_P(1.0) > 1.0)) {hatch = sqrt((hatch * abs(sin(((qy * 6.283185) + phase)))));}
var ink = clamp((((((a_P(10.0) + (((1.0 - (l * lighting))) * 0.35)) - hatch)) / max(0.02,aa)) + 0.5),0.0,1.0);
tone = (1.0 - ink);
lighting = (lighting * ((0.35 + (tone * 0.65))));
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade4(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var fx = (a_P(20.0) + ((rotatedX * 3.0) / a_P(7.0)));
var fy = (a_P(21.0) + ((rotatedY * 3.0) / a_P(7.0)));
if ((a_P(2.0) > 0.0)) {
var ox = ((a_P(54.0) * bx) + (a_P(55.0) * 3.0));
var zz = ((a_P(55.0) * bx) - (a_P(54.0) * 3.0));
var oy = ((a_P(56.0) * by) - (a_P(57.0) * zz));
var oz = ((a_P(57.0) * by) + (a_P(56.0) * zz));
var dx = -a_P(55.0);
var dy = (-a_P(57.0) * a_P(54.0));
var dz = (a_P(56.0) * a_P(54.0));
var red = 0.0;
var green = 0.0;
var blue = 0.0;
coverage = 0.0;
for (var j = 0.0;(j < 16.0);j += 1.0) {
if (((j >= a_P(3.0)) || (coverage > 0.9999))) {break;}
var z = (((j - (((a_P(3.0) - 1.0)) * 0.5))) * a_P(5.0));
var start = ((((z - (a_P(4.0) * 0.5)) - oz)) / a_Safe(dz));
var end = ((((z + (a_P(4.0) * 0.5)) - oz)) / a_Safe(dz));
var slabRed = 0.0;
var slabGreen = 0.0;
var slabBlue = 0.0;
var slabAlpha = 0.0;
for (var k = 0.0;(k < 4.0);k += 1.0) {
var t = mix(start,end,(k / 3.0));
var x = (ox + (dx * t));
var y = (oy + (dy * t));
var box = clamp(((((0.56 - max(abs(x),abs(y)))) / max(0.00001,a_AA())) + 0.5),0.0,1.0);
if (((t < 0.0) || (box == 0.0))) {continue;}
var mx = (a_P((20.0 + (j * 2.0))) + (((((a_P(52.0) * x) - (a_P(53.0) * y))) * 3.0) / a_P(7.0)));
var my = (a_P((21.0 + (j * 2.0))) + (((((a_P(53.0) * x) + (a_P(52.0) * y))) * 3.0) / a_P(7.0)));
var m = a_Mandel(mx,my,a_P(10.0));
var weight = ((clamp(((((m - a_P(14.0)) + 0.1)) / 0.1),0.0,1.0) * box) * 0.25);
var escape = ((m + (j * 0.07)) + (phase * 0.03));
var band = sin((((((escape * 25.0) * a_U(2.0)) / 2.0) + phase) + seed));
var tx = ((0.5 + x) + ((band * a_P(15.0)) * 0.06));
var ty = ((0.5 + y) + ((cos(((escape * 31.0) - phase)) * a_P(15.0)) * 0.06));
var paletteTone = clamp((0.5 + (band * 0.5)),0.0,1.0);
var light = mix(1.0,clamp((1.0 - (((z + ((((a_P(3.0) - 1.0)) * a_P(5.0)) * 0.5))) * 0.9)),0.25,1.0),a_P(13.0));
for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var value = a_T(tx,ty,ch);
if ((a_P(1.0) == 0.0)) {value = mix(a_Palette(paletteTone,ch),value,a_P(0.0));}
value = ((value * light) * weight);
if ((ch == 0.0)) {slabRed += value;} else if ((ch == 1.0)) {slabGreen += value;} else {slabBlue += value;}
}
slabAlpha += weight;
}
red += (slabRed * ((1.0 - coverage)));
green += (slabGreen * ((1.0 - coverage)));
blue += (slabBlue * ((1.0 - coverage)));
coverage += (slabAlpha * ((1.0 - coverage)));
}
advancedOut[u32(0.0)] = ((a_U(28.0) * ((1.0 - coverage))) + red);
advancedOut[u32(1.0)] = ((a_U(29.0) * ((1.0 - coverage))) + green);
advancedOut[u32(2.0)] = ((a_U(30.0) * ((1.0 - coverage))) + blue);
return;
}
tone = a_Mandel(fx,fy,a_P(10.0));
coverage = clamp(((((tone - a_P(14.0)) + 0.1)) / 0.1),0.0,1.0);
var fractalBand = sin((((((tone * 25.0) * a_U(2.0)) / 2.0) + phase) + seed));
sx = (sx + ((fractalBand * a_P(15.0)) * 0.06));
sy = (sy + ((cos(((tone * 31.0) - phase)) * a_P(15.0)) * 0.06));
tone = clamp((0.5 + (fractalBand * 0.5)),0.0,1.0);
if ((a_P(1.0) > 0.0)) {
for (var ch = 0.0;(ch < 3.0);ch += 1.0) {advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),(a_T(sx,sy,ch) * lighting),coverage);}
return;
}
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade5(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var cellx = floor(qx);
var celly = floor(qy);
var energy = 0.0;
var reach = a_P(3.0);
var width = a_P(7.0);
var glow = a_P(6.0);
var jitter = a_P(4.0);

for (var yy = -1.0;(yy <= 1.0);yy += 1.0) {
for (var xx = -1.0;(xx <= 1.0);xx += 1.0) {
var cx = (cellx + xx);
var cy = (celly + yy);
var ax = ((cx + 0.5) + ((sin((phase + (a_R(cx,cy,1.0) * 6.283185))) * jitter) * 0.28));
var ay = ((cy + 0.5) + ((cos((phase + (a_R(cx,cy,2.0) * 6.283185))) * jitter) * 0.28));
var gate = a_P(2.0);
var core = exp((-(((ax * ax) + (ay * ay))) / ((((a_U(2.0) * a_U(2.0)) * 0.1) + 0.1))));

if ((a_R(cx,cy,0.0) > gate)) {continue;}
if ((((5.0 == 5.0) && (a_P(1.0) == 0.0)) && (a_Lum((a_U(5.0) + ((ax / a_U(2.0)) / a_U(0.0))),(a_U(6.0) + ((ay / a_U(2.0)) / a_U(1.0)))) < 0.15))) {continue;}
var nodeDistance = sqrt(((((qx - ax)) * ((qx - ax))) + (((qy - ay)) * ((qy - ay)))));
energy = max(energy,exp(((-nodeDistance * nodeDistance) / max(0.0001,((width * width) * 6.0)))));
for (var branch = 0.0;(branch < 4.0);branch += 1.0) {
var nx = (cx + 1.0);
var ny = cy;
if ((branch == 1.0)) {
nx = cx;
ny = (cy + 1.0);
}
if ((branch == 2.0)) {
nx = (cx + 1.0);
ny = (cy + 1.0);
}
if ((branch == 3.0)) {
nx = (cx - 1.0);
ny = (cy + 1.0);
}
if ((a_R(nx,ny,0.0) > gate)) {continue;}
var ex = ((nx + 0.5) + ((sin((phase + (a_R(nx,ny,1.0) * 6.283185))) * jitter) * 0.28));
var ey = ((ny + 0.5) + ((cos((phase + (a_R(nx,ny,2.0) * 6.283185))) * jitter) * 0.28));
var len = sqrt(((((ex - ax)) * ((ex - ax))) + (((ey - ay)) * ((ey - ay)))));
if ((len > (reach * 1.6))) {continue;}
var distance = 100.0;
{
var lastx = ax;
var lasty = ay;
for (var segment = 1.0;(segment <= 4.0);segment += 1.0) {
var t = (segment / 4.0);
var bend = (((sin((t * 3.141593)) * sin(((phase * 2.0) + (a_R(cx,cy,(segment + 3.0)) * 12.0)))) * jitter) * 0.3);
var endx = (mix(ax,ex,t) + bend);
var endy = (mix(ay,ey,t) - bend);
distance = min(distance,a_Segment(qx,qy,lastx,lasty,endx,endy));
lastx = endx;
lasty = endy;
}
}
var light = (exp(((-distance * distance) / max(0.00001,(width * width)))) + ((exp(((-distance * distance) / ((0.008 + (glow * 0.08))))) * glow) * 0.25));
light = ((light * a_P(5.0)) * ((0.65 + (0.35 * sin(((((phase * 2.0) + (qx * 4.0)) + (qy * 3.0)) + (a_R(cx,cy,7.0) * 6.0)))))));
energy = max(energy,light);
}
}
}
coverage = clamp(energy,0.0,1.0);
tone = a_N(((qx * 0.2) + (phase * 0.1)),(qy * 0.2));
lighting = (0.7 + (coverage * 0.6));
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade6(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var xx = (qx + ((sin((((qy * 0.7) + phase) + seed)) * a_P(3.0)) * 0.75));
var column = floor(xx);
var yy = ((qy / a_P(2.0)) + ((column * a_P(6.0)) * 0.5));
var row = floor(yy);
var dx = ((xx - column) - 0.5);
var dy = ((yy - row) - 0.5);
var distance = sqrt(((dx * dx) + (dy * dy)));
if ((a_P(1.0) == 2.0)) {distance = max(abs(dx),abs(dy));}
var radius = a_P(5.0);
var extent = radius;
if ((a_P(1.0) == 0.0)) {
distance = abs((distance - (radius * 0.75)));
extent = (radius * a_P(7.0));
}
coverage = clamp(((((extent - distance)) / aa) + 0.5),0.0,1.0);
if ((a_R(column,row,1.0) < a_P(4.0))) {coverage = 0.0;}
tone = (((a_R(column,row,2.0) * 0.5) + (sin((phase + (column * 0.35))) * 0.25)) + 0.25);
if ((a_P(1.0) == 1.0)) {lighting = (0.4 + (sqrt(max(0.0,(1.0 - ((((dx * dx) + (dy * dy))) / ((radius * radius)))))) * 0.8));}
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade7(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var r = (sqrt(((qx * qx) + (qy * qy))) / 3.0);
var theta = a_ATAN(qy,qx);
var brightest = 0.0;
coverage = 0.0;
for (var j = 0.0;(j < 12.0);j += 1.0) {
if ((j >= a_P(3.0))) {break;}
var center = ((((j + 1.0)) / ((a_P(3.0) + 1.0))) * 0.45);
var half = (((0.5 / ((a_P(3.0) + 1.0)))) * ((0.6 + a_P(5.0))));
var a = (((theta + (phase * ((0.1 + (j * 0.025))))) + ((j * a_P(7.0)) * 0.0174533)) + (seed * 0.05));
var sector = ((a * a_P(2.0)) / 6.283185);
var cell = floor(sector);
var local = (sector - cell);
var radial = (abs((r - center)) / max(0.001,half));
var triangular = (radial + (abs((local - 0.5)) * 1.4));
if ((a_P(1.0) > 0.0)) {triangular = (radial + abs((local - 0.5)));}
var fill = clamp(((((1.0 - triangular)) / max(0.01,(a_AA() * 10.0))) + 0.5),0.0,1.0);
var facet = floor((local * a_P(4.0)));
var edge = min(abs((1.0 - triangular)),abs(((local * a_P(4.0)) - floor((local * a_P(4.0))))));
var ink = clamp((((((a_P(6.0) * 0.15) - edge)) / max(0.005,(a_AA() * 5.0))) + 0.5),0.0,1.0);
if ((fill > brightest)) {
brightest = fill;
coverage = fill;
tone = ((a_R(cell,j,2.0) * 0.45) + ((facet / a_P(4.0)) * 0.55));
lighting = (1.0 - (ink * 0.65));
}
}
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade8(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var cellx = floor(qx);
var celly = floor(qy);
var energy = 0.0;
var reach = a_P(3.0);
var width = a_P(7.0);
var glow = a_P(6.0);
var jitter = a_P(4.0);
{
width = a_P(5.0);
glow = a_P(6.0);
jitter = a_P(7.0);
}
for (var yy = -1.0;(yy <= 1.0);yy += 1.0) {
for (var xx = -1.0;(xx <= 1.0);xx += 1.0) {
var cx = (cellx + xx);
var cy = (celly + yy);
var ax = ((cx + 0.5) + ((sin((phase + (a_R(cx,cy,1.0) * 6.283185))) * jitter) * 0.28));
var ay = ((cy + 0.5) + ((cos((phase + (a_R(cx,cy,2.0) * 6.283185))) * jitter) * 0.28));
var gate = a_P(2.0);
var core = exp((-(((ax * ax) + (ay * ay))) / ((((a_U(2.0) * a_U(2.0)) * 0.1) + 0.1))));
if (((8.0 == 8.0) && (a_P(1.0) == 0.0))) {gate = (gate * mix(1.0,core,a_P(4.0)));}
if ((a_R(cx,cy,0.0) > gate)) {continue;}

var nodeDistance = sqrt(((((qx - ax)) * ((qx - ax))) + (((qy - ay)) * ((qy - ay)))));
energy = max(energy,exp(((-nodeDistance * nodeDistance) / max(0.0001,((width * width) * 6.0)))));
for (var branch = 0.0;(branch < 4.0);branch += 1.0) {
var nx = (cx + 1.0);
var ny = cy;
if ((branch == 1.0)) {
nx = cx;
ny = (cy + 1.0);
}
if ((branch == 2.0)) {
nx = (cx + 1.0);
ny = (cy + 1.0);
}
if ((branch == 3.0)) {
nx = (cx - 1.0);
ny = (cy + 1.0);
}
if ((a_R(nx,ny,0.0) > gate)) {continue;}
var ex = ((nx + 0.5) + ((sin((phase + (a_R(nx,ny,1.0) * 6.283185))) * jitter) * 0.28));
var ey = ((ny + 0.5) + ((cos((phase + (a_R(nx,ny,2.0) * 6.283185))) * jitter) * 0.28));
var len = sqrt(((((ex - ax)) * ((ex - ax))) + (((ey - ay)) * ((ey - ay)))));
if ((len > (reach * 1.6))) {continue;}
var distance = 100.0;
distance = a_Segment(qx,qy,ax,ay,ex,ey);
var light = (exp(((-distance * distance) / max(0.00001,(width * width)))) + ((exp(((-distance * distance) / ((0.008 + (glow * 0.08))))) * glow) * 0.25));

energy = max(energy,light);
}
}
}
coverage = clamp(energy,0.0,1.0);
tone = a_N(((qx * 0.2) + (phase * 0.1)),(qy * 0.2));
lighting = (0.7 + (coverage * 0.6));
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade9(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var normalx = 0.0;
var normaly = 0.0;
var normalz = 1.0;
if ((a_P(2.0) > 0.0)) {
var t = 1.0;
var nearest = 100.0;
var closest = 1.0;
for (var j = 0.0;(j < 56.0);j += 1.0) {
var z = (-1.4 + t);
var d = a_FoilDistance(bx,by,z,u,v);
if ((d < nearest)) {
nearest = d;
closest = t;
}
t += max(0.0,(d * 0.65));
if ((t > 2.8)) {break;}
}
coverage = clamp((((0.002 - nearest)) / 0.001),0.0,1.0);
if ((coverage > 0.0)) {
var z = (-1.4 + closest);
var e = 0.003;
normalx = (a_FoilDistance((bx + e),by,z,u,v) - a_FoilDistance((bx - e),by,z,u,v));
normaly = (a_FoilDistance(bx,(by + e),z,u,v) - a_FoilDistance(bx,(by - e),z,u,v));
normalz = (a_FoilDistance(bx,by,(z + e),u,v) - a_FoilDistance(bx,by,(z - e),u,v));
var norm = max(0.0001,sqrt((((normalx * normalx) + (normaly * normaly)) + (normalz * normalz))));
normalx = (normalx / norm);
normaly = (normaly / norm);
normalz = (normalz / norm);
sx = clamp((0.5 + (normalx * 0.5)),0.0,1.0);
sy = clamp((0.5 + (normaly * 0.5)),0.0,1.0);
}
} else {
var eps = 0.004;
var foldx = ((cos((((qx * a_P(6.0)) + phase) + seed)) * a_P(7.0)) * 1.8);
var foldy = ((sin(((qy * a_P(6.0)) - phase)) * a_P(7.0)) * 1.8);
normalx = (foldx + ((((a_H((u + eps),v) - a_H((u - eps),v))) * a_P(10.0)) * 30.0));
normaly = (foldy + ((((a_H(u,(v + eps)) - a_H(u,(v - eps)))) * a_P(10.0)) * 30.0));
var norm = sqrt((((normalx * normalx) + (normaly * normaly)) + 1.0));
normalx = (normalx / norm);
normaly = (normaly / norm);
normalz = (1.0 / norm);
}
var light = (a_P(11.0) * 0.0174533);
var reflection = (((normalx * cos(light)) - (normaly * sin(light))) + (normalz * 0.5));
var sharpness = mix(14.0,1.0,a_P(8.0));
if ((a_P(1.0) > 0.0)) {sharpness = (sharpness * 1.8);}
var highlight = pow(clamp(((reflection * 0.5) + 0.5),0.0,1.0),sharpness);
tone = clamp((((0.5 + (normalx * 0.3)) + (normaly * 0.2)) + (sin((phase + (reflection * 4.0))) * 0.1)),0.0,1.0);
lighting = mix((0.65 + (normalz * 0.25)),((0.15 + (highlight * 1.8)) + (abs(sin(((reflection * 5.0) + phase))) * 0.2)),a_P(9.0));
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade10(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var size = (a_P(2.0) * a_U(2.0));
var nx = (qx + ((((a_N(((qx * 3.0) + phase),(qy * 3.0)) - 0.5)) * a_P(5.0)) * size));
var ny = (qy + ((((a_N((qx * 3.0),((qy * 3.0) - phase)) - 0.5)) * a_P(5.0)) * size));
var cx = floor((nx / size));
var cy = floor((ny / size));
var dropout = (a_R(cx,cy,0.0) < a_P(6.0));
var erosion = 1.0;
if ((a_P(1.0) > 1.0)) {erosion = clamp((((a_N(((qx * 12.0) + phase),(qy * 12.0)) - (a_P(5.0) * 0.65))) * 5.0),0.0,1.0);}
var travelx = ((((a_R(cx,cy,1.0) - 0.5)) * a_P(7.0)) * 0.25);
var travely = ((((a_R(cx,cy,2.0) - 0.5)) * a_P(7.0)) * 0.25);
var sx = (u + travelx);
var sy = (v + travely);
var rot = (a_P(8.0) * 0.0174533);
var stripe = sin((((((qx * cos(rot)) + (qy * sin(rot)))) * 30.0) + phase));
var striped = clamp((((stripe - ((1.0 - (a_P(4.0) * 2.0))))) / max(aa,0.03)),0.0,1.0);
for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var value = a_T(sx,sy,ch);
var quantized = (floor((value * a_P(3.0))) / max(1.0,(a_P(3.0) - 1.0)));
var ink = (mix(a_Palette((quantized + (a_R(cx,cy,3.0) * 0.1)),ch),quantized,a_P(0.0)) * ((0.55 + (striped * 0.45))));
var coverage = erosion;
if (dropout) {coverage = 0.0;}
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),ink,coverage);
}
return;
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
fn a_Shade11(u:f32,v:f32,px:f32,py:f32) {
var phase = a_U(4.0);
var seed = a_U(7.0);
var bx = (((u - a_U(5.0))) * a_U(0.0));
var by = (((v - a_U(6.0))) * a_U(1.0));
var angle = a_U(22.0);
var rotatedX = ((a_P(52.0) * bx) - (a_P(53.0) * by));
var rotatedY = ((a_P(53.0) * bx) + (a_P(52.0) * by));
var qx = (rotatedX * a_U(2.0));
var qy = (rotatedY * a_U(2.0));
var aa = max(0.001,(a_AA() * a_U(2.0)));
var tone = 0.0;
var coverage = 1.0;
var sx = u;
var sy = v;
var lighting = 1.0;
{
var distance = sqrt(((bx * bx) + (by * by)));
var theta = a_ATAN(qy,qx);
var half = ((a_P(2.0) * 0.0174533) * 0.5);
var fan = clamp((((half - abs(theta))) / max(aa,0.005)),0.0,1.0);
var beam = (0.5 + (0.5 * cos((((theta * max(2.0,a_U(20.0))) + phase) + seed))));
var grating = (0.6 + (0.4 * sin((((distance * a_P(4.0)) * 6.283185) + phase))));
var reach = clamp((1.0 - (distance / a_P(3.0))),0.0,1.0);
coverage = (((fan * reach) * clamp((((beam - a_U(10.0))) / max(0.01,(1.0 - a_U(10.0)))),0.0,1.0)) * ((0.5 + (grating * 0.5))));
tone = clamp(((((theta / max(0.01,half)) * 0.5) + 0.5) + (grating * 0.15)),0.0,1.0);
lighting = 1.2;
}

for (var ch = 0.0;(ch < 3.0);ch += 1.0) {
var material = (mix(a_Palette(tone,ch),a_T(sx,sy,ch),a_P(0.0)) * lighting);
advancedOut[u32(ch)] = mix(a_U((28.0 + ch)),material,coverage);
}
}
`;
