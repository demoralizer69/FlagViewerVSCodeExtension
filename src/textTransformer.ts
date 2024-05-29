import { spawn } from 'child_process';
/**
 * all #include and #pragma statements are prepended this before
 * going into the preprocessor and then this is removed
 * from the output.
 */
const flagViewerPrefix = "//__FLAGVIEWER_COMMENT_PREFIX__//";
const flagViewerSuffix = "//__FLAGVIEWER_COMMENT_SUFFIX__//";

// reads text from given editor and transforms includes and pragmas
export const transformText = (text : string, expandDefines : boolean) : string => {
	// checks if the statement is an include or pragma statement
	const isIgnorablePreprocessorDirective = (line : string) : boolean => {
		line = line.trim();
		if(line === '') {
			return true;
		}
		if(!line.startsWith('#')){
			return false;
		}
		line = line.slice(1).trim();
		return line.startsWith('include') ||
				line.startsWith('pragma') || (
					(line.startsWith('define') || line.startsWith('undef')) &&
					!expandDefines
				);
	};
	const lineEndsAtBackslash = (line : string) : boolean => {
		line = line.trim();
		return line.endsWith('\\');
	};
	return text
			.split('\n')
			.map((line) => !isIgnorablePreprocessorDirective(line) ? line : flagViewerPrefix.concat(line))
			.map((line) => (lineEndsAtBackslash(line) && !expandDefines) ? line.concat(flagViewerSuffix): line)
			.join('\n');
};

// get output of the processor and remove include/pragma comment
export const getProcessedOutput = async (text : string, flagsArr : string[], expandDefines : boolean) : Promise<string> => {
	const child = spawn('g++', ['-x', 'c++', '-C', '-E', '-P', ...flagsArr, '-', '-o-']);
	child.stdin.write(text);
	child.stdin.end();
	const preprocessorOutput = await new Response(child.stdout).text();
	const finalOutput = preprocessorOutput
								.split('\n')
								.map((line) => line.startsWith(flagViewerPrefix) ? line.slice(flagViewerPrefix.length) : line)
								.map((line) => (line.endsWith(flagViewerSuffix) && !expandDefines) ? line.slice(0,-flagViewerSuffix.length) : line)
								.join('\n');
	return finalOutput;
};
