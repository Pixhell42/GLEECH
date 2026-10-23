import { verifyUpdatePackage } from './update-package-verifier.mjs';

console.log(JSON.stringify(await verifyUpdatePackage(...process.argv.slice(2))));
