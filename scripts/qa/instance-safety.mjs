import path from "node:path";

export function normalizeWindowsPath(value) {
  return String(value ?? "").replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

export function profileArgument(commandLine) {
  const tokens=[];
  let current="",quoted=false,started=false;
  for(const c of String(commandLine ?? "")) {
    if(c==='"'){quoted=!quoted;started=true;continue;}
    if(!quoted&&/\s/.test(c)){if(started){tokens.push(current);current="";started=false;}continue;}
    current+=c;started=true;
  }
  if(quoted)return null;
  if(started)tokens.push(current);
  const positions = tokens.flatMap((v, i) => v.toLowerCase() === "-profile" ? [i] : []);
  if (positions.length !== 1) return null;
  const value = tokens[positions[0] + 1];
  if (!value || value.startsWith("-")) return null;
  return value;
}

export function ownsInstance(row, executable, profileDir) {
  return Number.isInteger(Number(row?.ProcessId)) && Number(row.ProcessId) > 0 &&
    normalizeWindowsPath(row.ExecutablePath) === normalizeWindowsPath(executable) &&
    normalizeWindowsPath(profileArgument(row.CommandLine)) === normalizeWindowsPath(profileDir);
}

export function assertInsideQa(qaRoot, candidate) {
  const root = path.resolve(qaRoot);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing cleanup outside QA child path: ${target}`);
  }
  return target;
}
