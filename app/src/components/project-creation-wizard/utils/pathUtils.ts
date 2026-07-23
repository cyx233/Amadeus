const SSH_PREFIXES = ['git@', 'ssh://'];

export const isSshGitUrl = (url: string): boolean => {
  const trimmedUrl = url.trim();
  return SSH_PREFIXES.some((prefix) => trimmedUrl.startsWith(prefix));
};

export const shouldShowGithubAuthentication = (githubUrl: string): boolean =>
  githubUrl.trim().length > 0 && !isSshGitUrl(githubUrl);

export const isCloneWorkflow = (githubUrl: string): boolean =>
  githubUrl.trim().length > 0;
