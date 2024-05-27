import * as vscode from 'vscode';
import { spawn } from 'child_process';

/**
 * all #include and #pragma statements are prepended this before
 * going into the preprocessor and then this is removed
 * from the output.
 */
const flagViewerPrefix = "//__FLAGVIEWER_COMMENT_PREFIX__//";
const flagViewerSuffix = "//__FLAGVIEWER_COMMENT_SUFFIX__//";

/**
 * Scan a file text to find all flags in the file
 * @param text Text of the entire document
 * @returns array of flags present in the file
 */
const scanFlagsFromText = (text : string) : string[] => {
	let flagsArr : string[] = [];
	let pos = 0;
	while(pos !== -1){
		pos = text.indexOf("defined(", pos);
		if(pos === -1){
			break;
		}
		pos = pos + "defined(".length;
		let end = text.indexOf(")", pos);
		if(end === -1){
			break;
		}
		flagsArr = [...flagsArr, text.slice(pos, end)];
		pos = end;
	}
	return [...new Set(flagsArr)];
};

// reads text from given editor and transforms includes and pragmas
const transformText = (text : string, expandDefines : boolean) : string => {
	// checks if the statement is an include or pragma statement
	const isIgnorablePreprocessorDirective = (line : string) : boolean => {
		line = line.trim();
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
const getProcessedOutput = async (text : string, flagsArr : string[], expandDefines : boolean) : Promise<string> => {
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

// use input boxes to take flags from input
const getFlagsFromInput = async (scannedFlags : string[]) : Promise<string[]> => {
	const flagPickerInput = await vscode.window.showQuickPick(
		scannedFlags, {
			ignoreFocusOut : true,
			canPickMany : true,
			title : "FlagViewer",
			placeHolder: "Choose relevant flags from the list and press Enter",
		},
	);
	if(flagPickerInput === undefined){
		return undefined as unknown as string[];
	}
	// const extraFlagsInput = await vscode.window.showInputBox({
	// 	ignoreFocusOut: true,
	// 	placeHolder: "(ex: FLAG_A,FLAG_B)",
	// 	prompt: "Write a list of comma-separated flags not in the previous list",
	// 	title : "FlagViewer",
	// });
	// if(extraFlagsInput === undefined){
	// 	return undefined as unknown as string[];
	// }
	// const flagsArr = extraFlagsInput
	// 					.split(',')
	// 					.filter((e) => e !== '')
	// 					.concat(flagPickerInput)
	const flagsArr = flagPickerInput
						.map((e) => `-D${e}`);
	return flagsArr;
};

const getGitRevisionFromInput = async (fileUri : vscode.Uri) : Promise<string> => {
	const fileDir = fileUri.path.split('/').slice(0,-1).join('/');

	const child = spawn(
		'git',
		['rev-list', '--all', '--pretty=oneline', '--abbrev=40'],
		{cwd : fileDir},
	);
	const gitRefs = (await new Response(child.stdout).text()).split('\n');
	const pickedItem = await vscode.window.showQuickPick(
		['HEAD', ...gitRefs], {
			title : "FlagViewer",
			placeHolder: "Choose a git revision to compare with",
		},
	);
	if(pickedItem === undefined){
		return undefined as unknown as string;
	}
	const chosenGitRef = pickedItem.slice(0,40);
	return chosenGitRef;
};

const getFileTextFromRevision = async (gitRef : string, fileUri : vscode.Uri) : Promise<string> => {
	const fileDir = fileUri.path.split('/').slice(0,-1).join('/');
	const fileName = fileUri.path.split('/').at(-1);
	const child = spawn(
		'git',
		['show', `${gitRef}:./${fileName}`],
		{cwd : fileDir},
	);
	return new Response(child.stdout).text();
};

// open a vscode compare with the given uri and text
const openVSCodeCompareWithText = async (context : vscode.ExtensionContext, fileUri : vscode.Uri, text : string) => {
	const myProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return text;
		}
	})();
	const registration = vscode.workspace.registerTextDocumentContentProvider(`flag-view`, myProvider);
	context.subscriptions.push(registration);
	const fileName = fileUri.path.split('/').at(-1);
	const flagViewerUri = vscode.Uri.parse(`flag-view://${fileUri.path}`);
	await vscode.commands.executeCommand("vscode.diff", fileUri, flagViewerUri, `FlagViewer: ${fileName}`);
	vscode.commands.executeCommand("workbench.action.keepEditor");
};

// open a vscode compare between two texts
const openVSCodeCompareBetweenTexts = async (context : vscode.ExtensionContext, fileUri : vscode.Uri, textCurrent : string, textRef : string) => {
	const myProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return uri.authority === 'current' ? textCurrent : textRef;
		}
	})();
	const registration = vscode.workspace.registerTextDocumentContentProvider(`flag-view`, myProvider);
	context.subscriptions.push(registration);
	const fileName = fileUri.path.split('/').at(-1);
	const textUriCurrent = vscode.Uri.parse(`flag-view://current/${fileUri.path}`);
	const textUriRef = vscode.Uri.parse(`flag-view://ref/${fileUri.path}`);
	await vscode.commands.executeCommand("vscode.diff", textUriCurrent, textUriRef, `FlagViewer: ${fileName}`);
	vscode.commands.executeCommand("workbench.action.keepEditor");
};

// expandDefines -> true/false
const viewWithFlagsCommandHandler = async (context : vscode.ExtensionContext, expandDefines : boolean) => {
	// --- get file text from the active editor ---
	const editor = vscode.window.activeTextEditor;
	if(editor === undefined){
		return;
	}
	const docUri = editor.document.uri;
	const transformedText = transformText(editor.document.getText(), expandDefines);

	// --- get flags from input boxes ---
	const flagsArr = await getFlagsFromInput(scanFlagsFromText(transformedText));
	if(flagsArr === undefined){
		return;
	}

	// --- get preprocessor output based on file text and chosen flags ---
	const processedOutput = await getProcessedOutput(transformedText, flagsArr, expandDefines);

	// --- open a vscode compare between original file and preprocessor output ---
	openVSCodeCompareWithText(context, docUri, processedOutput);
};

const viewGitDiffWithFlagsCommandHandler = async (context : vscode.ExtensionContext, expandDefines : boolean) => {
	// --- get file text from the active editor ---
	const editor = vscode.window.activeTextEditor;
	if(editor === undefined){
		return;
	}
	const docUri = editor.document.uri;
	const transformedText = transformText(editor.document.getText(), expandDefines);

	// --- get git hash from input ---
	const gitRef = await getGitRevisionFromInput(docUri);
	if(gitRef === undefined){
		return;
	}
	const oldFileText = await getFileTextFromRevision(gitRef, docUri);
	const transformedOldText = transformText(oldFileText, expandDefines);
	const flagsArr = await getFlagsFromInput(scanFlagsFromText(transformedText));
	const processedText = await getProcessedOutput(transformedText, flagsArr, expandDefines);
	const processedOldText = await getProcessedOutput(transformedOldText, flagsArr, expandDefines);
	openVSCodeCompareBetweenTexts(context, docUri, processedText, processedOldText);
};

// this function is called when the extension is initially activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "flagviewer" is now active!');

	const viewWithFlagsDisposable = vscode.commands.registerCommand(
		'flagviewer.viewWithFlags',
		async () => viewWithFlagsCommandHandler(context, false),
	);

	const viewWithFlagsExpandDefinesDisposable = vscode.commands.registerCommand(
		'flagviewer.viewWithFlagsExpandDefines',
		async () => viewWithFlagsCommandHandler(context, true),
	);

	const viewGitDiffWithFlagsDisposable = vscode.commands.registerCommand(
		'flagviewer.viewGitDiffWithFlags',
		async () => viewGitDiffWithFlagsCommandHandler(context, true),
	);

	context.subscriptions.push(viewWithFlagsDisposable, viewWithFlagsExpandDefinesDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
