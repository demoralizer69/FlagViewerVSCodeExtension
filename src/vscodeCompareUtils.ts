import * as vscode from 'vscode';

// open a vscode compare between two uris
export const openVSCodeCompareBetweenUris = async (uri1 : vscode.Uri, uri2 : vscode.Uri, title : any) => {
	await vscode.commands.executeCommand("vscode.diff", uri1, uri2, `FlagViewer: ${title}`);
	vscode.commands.executeCommand("workbench.action.keepEditor");
};

// open a vscode compare between two texts
export const openVSCodeCompareBetweenTexts = async (context : vscode.ExtensionContext, fileUri : vscode.Uri, textCurrent : string, textRef : string) => {
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
