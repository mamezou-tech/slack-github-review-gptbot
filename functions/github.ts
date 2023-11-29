import { App, Octokit } from 'octokit';
import { getParameter } from './config';
import { createAppAuth } from '@octokit/auth-app';
import { Endpoints } from '@octokit/types/dist-types/generated/Endpoints';

async function createOctokit(owner: string, repo: string) {
  const privateKey = await getParameter('githubAppPrivateKey');
  const appId = await getParameter('githubAppId');
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey }
  });
  const installation = await octokit.rest.apps.getRepoInstallation({ owner, repo });
  const installationId = installation.data.id;

  const app = new App({ appId, privateKey });
  return (await app.getInstallationOctokit(installationId)) as Octokit;
}

async function listPR({ repo, owner }: { repo: string; owner: string }) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.pulls.list({ repo, owner });
  return resp.data.map(pr => ({
    url: pr.url,
    number: pr.number,
    title: pr.title,
    user: pr.user?.login,
    state: pr.state,
    body: pr.body,
    labels: pr.labels.map(label => ({ name: label.name, description: label.description })),
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    closed_at: pr.closed_at,
    merged_at: pr.merged_at,
    assignee: pr.assignee?.login,
    reviewers: pr.requested_reviewers?.map(reviewer => reviewer.login),
    head: {
      repo: pr.head.repo?.name,
      ref: pr.head.ref
    },
    base: {
      repo: pr.base.repo?.name,
      ref: pr.base.ref
    },
    auto_merge: pr.auto_merge,
    draft: pr.draft
  }));
}

async function getPR(search: { repo: string, owner: string, pull_number: number }) {
  const client = await createOctokit(search.owner, search.repo);
  const resp = await client.rest.pulls.get(search);
  const pr = resp.data;
  return {
    url: pr.url,
    number: pr.number,
    title: pr.title,
    user: pr.user?.login,
    state: pr.state,
    body: pr.body,
    labels: pr.labels.map(label => ({ name: label.name, description: label.description })),
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    closed_at: pr.closed_at,
    merged_at: pr.merged_at,
    assignee: pr.assignee?.login,
    reviewers: pr.requested_reviewers?.map(reviewer => reviewer.login),
    head: {
      repo: pr.head.repo?.name,
      ref: pr.head.ref
    },
    base: {
      repo: pr.base.repo?.name,
      ref: pr.base.ref
    },
    auto_merge: pr.auto_merge,
    draft: pr.draft,
    merged: pr.merged,
    mergeable: pr.mergeable,
    rebaseable: pr.rebaseable,
    mergeable_state: pr.mergeable_state,
    merged_by: pr.merged_by?.login,
    comments: pr.comments,
    review_comments: pr.rebaseable,
    maintainer_can_modify: pr.maintainer_can_modify,
    commits: pr.commits,
    additions: pr.additions,
    deletions: pr.draft,
    changed_files: pr.changed_files
  };
}

async function listReview(request: { repo: string, owner: string, pull_number: number }) {
  const client = await createOctokit(request.owner, request.repo);
  const resp = await client.rest.pulls.listReviews(request);
  const reviews = resp.data;
  return reviews.map(review => ({
    id: review.id,
    user: review.user?.login,
    body: review.body,
    state: review.state,
    html_url: review.html_url,
    submitted_at: review.submitted_at,
    commit_id: review.commit_id
  }));
}

type MergePRRequest = Endpoints['PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge']['parameters']
async function mergePR(request: MergePRRequest) {
  const client = await createOctokit(request.owner, request.repo);
  const resp = await client.rest.pulls.merge({
    ...request,
    merge_method: request.merge_method ?? 'squash'
  });
  return resp.data;
}

async function updatePRBranch({ repo, owner, pull_number }: { repo: string, owner: string, pull_number: number }) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.pulls.updateBranch({ repo, owner, pull_number });
  return resp.data;
}

async function listPRFiles({ repo, owner, pull_number }: { repo: string, owner: string, pull_number: number }) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.pulls.listFiles({ repo, owner, pull_number });
  return resp.data.map(file => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    raw_url: file.raw_url,
    patch: file.patch
  }));
}

type CreateReviewRequest = Endpoints['POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews']['parameters']

async function createReview(request: CreateReviewRequest) {
  const client = await createOctokit(request.owner, request.repo);
  const resp = await client.rest.pulls.createReview(request);
  return {
    message: `created review for ${resp.data.id}`
  };
}

async function listReviewComments({ repo, owner, pull_number }: { repo: string, owner: string, pull_number: number }) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.pulls.listReviewComments({ repo, owner, pull_number });
  return resp.data.map(comment => ({
    id: comment.id,
    pull_request_review_id: comment.pull_request_review_id,
    url: comment.url,
    path: comment.path,
    position: comment.position,
    commit_id: comment.commit_id,
    user: comment.user.login,
    body: comment.body,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    html_url: comment.html_url,
    start_line: comment.start_line,
    original_start_line: comment.original_start_line,
    start_side: comment.start_side,
    line: comment.line,
    original_line: comment.original_line,
    side: comment.side
  }));
}

type DeleteReviewCommentRequest = Endpoints['DELETE /repos/{owner}/{repo}/comments/{comment_id}']['parameters']
async function deleteReviewComment(request: DeleteReviewCommentRequest) {
  const client = await createOctokit(request.owner, request.repo);
  await client.rest.pulls.deleteReviewComment(request);
  return {
    message: `deleted review comment for ${request.comment_id}`
  };
}

type UpdateReviewCommentRequest = Endpoints['PATCH /repos/{owner}/{repo}/comments/{comment_id}']['parameters']
async function updateReviewComment(request: UpdateReviewCommentRequest) {
  const client = await createOctokit(request.owner, request.repo);
  await client.rest.pulls.updateReviewComment(request);
  return {
    message: `deleted review comment for ${request.comment_id}`
  };
}

async function listIssueComments({ repo, owner, issue_number }: { repo: string; owner: string; issue_number: number; }) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.issues.listComments({ repo, owner, issue_number });
  return resp.data.map(comment => ({
    url: comment.url,
    user: comment.user?.login,
    body: comment.body,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    html_url: comment.html_url
  }));
}

async function createIssueComments({ repo, owner, issue_number, body }: {
  repo: string;
  owner: string;
  issue_number: number;
  body: string
}) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.issues.createComment({ repo, owner, issue_number, body });
  const comment = resp.data;
  return {
    url: comment.url,
    html_url: comment.html_url
  };
}

async function addLabels({ repo, owner, issue_number, labels }: {
  repo: string;
  owner: string;
  issue_number: number;
  labels: string[]
}) {
  const client = await createOctokit(owner, repo);
  await client.rest.issues.addLabels({ repo, owner, issue_number, labels });
  return {
    message: `added labels ${labels.join(',')}`
  };
}

async function listCommits({ repo, owner, pull_number }: { repo: string; owner: string; pull_number: number; }) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.pulls.listCommits({ repo, owner, pull_number });
  return resp.data.map(commit => ({
    url: commit.url,
    html_url: commit.html_url,
    author: commit.author?.login,
    committer: commit.committer?.login,
    message: commit.commit.message,
    verified: commit.commit.verification?.verified
  }));
}

async function requestReview({ repo, owner, pull_number, reviewers }: {
  repo: string;
  owner: string;
  pull_number: number;
  reviewers: string[]
}) {
  const client = await createOctokit(owner, repo);
  await client.rest.pulls.requestReviewers({ repo, owner, pull_number, reviewers });
  return {
    message: `Requested review to ${reviewers.join(',')}`
  };
}

async function getContents({ repo, owner, path, ref }: { repo: string, owner: string, path: string, ref?: string }) {
  const client = await createOctokit(owner, repo);
  const resp = await client.rest.repos.getContent({ repo, owner, path, ref });

  if (Array.isArray(resp.data)) {
    return resp.data.map((child) => ({
      type: child.type,
      size: child.size,
      name: child.name,
      path: child.path,
      html_url: child.html_url
    }));
  }

  if (resp.data.type === 'file') {
    return {
      type: resp.data.type,
      encoding: resp.data.encoding,
      size: resp.data.size,
      name: resp.data.name,
      path: resp.data.path,
      content: resp.data.content,
      html_url: resp.data.html_url
    };
  } else {
    return {
      type: resp.data.type,
      size: resp.data.size,
      name: resp.data.name,
      path: resp.data.path,
      html_url: resp.data.html_url
    };
  }
}

export const functions = {
  listPR,
  listReview,
  getPR,
  mergePR,
  listPRFiles,
  listReviewComments,
  updateReviewComment,
  deleteReviewComment,
  updatePRBranch,
  listIssueComments,
  listCommits,
  getContents,
  createIssueComments,
  requestReview,
  createReview,
  addLabels
};

const baseProps = {
  owner: {
    type: 'string',
    description:
      'The account owner of the repository. The name is not case sensitive.'
  },
  repo: {
    type: 'string',
    description:
      'The name of the repository without the .git extension. The name is not case sensitive.'
  }
};
export const functionDefinitions = [
  {
    name: listPR.name,
    description: 'Retrieve all GitHub pull requests(PR).',
    parameters: {
      type: 'object',
      properties: { ...baseProps },
      required: ['owner', 'repo']
    }
  },
  {
    name: listReview.name,
    description: 'List reviews for a pull request.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        }
      },
      required: ['owner', 'repo', 'pull_number']
    }
  },
  {
    name: getPR.name,
    description: 'Merge GitHub Pull Request(PR).',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        }
      },
      required: ['owner', 'repo', 'pull_number']
    }
  },
  {
    name: mergePR.name,
    description: 'Merges a pull request into the base branch.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        },
        merge_method: {
          type: 'string',
          description: 'The merge method to use. default to squash.',
          enum: ['merge', 'squash', 'rebase']
        }
      },
      required: ['owner', 'repo', 'pull_number']
    }
  },
  {
    name: updatePRBranch.name,
    description:
      'Updates the pull request branch with the latest upstream changes by merging HEAD from the base branch into the pull request branch..',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        }
      },
      required: ['owner', 'repo', 'pull_number']
    }
  },
  {
    name: listPRFiles.name,
    description: 'Retrieves a list of target files for a pull request. The response will include not only the modified file but also the file diff (`patch` field)',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        }
      },
      required: ['owner', 'repo', 'pull_number']
    }
  },
  {
    name: listReviewComments.name,
    description:
      'Lists all review comments for a pull request. Review comments are in ascending order by ID.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        }
      },
      required: ['owner', 'repo', 'pull_number']
    }
  },
  {
    name: updateReviewComment.name,
    description:
      'Update a review comment for a pull request. The `comment_id` will be included in the `listReviewComments` response(`id` property).',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        comment_id: {
          type: 'integer',
          description: 'The unique identifier of the comment.'
        },
        body: {
          type: 'string',
          description: 'The text of the reply to the review comment.'
        }
      },
      required: ['owner', 'repo', 'comment_id', 'body']
    }
  },
  {
    name: deleteReviewComment.name,
    description:
      'Delete a review comment for a pull request. The `comment_id` will be included in the `listReviewComments` response(`id` property).',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        comment_id: {
          type: 'integer',
          description: 'The unique identifier of the comment.'
        }
      },
      required: ['owner', 'repo', 'comment_id']
    }
  },
  {
    name: requestReview.name,
    description:
      'Requests reviews for a pull request from a given set of users.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        },
        reviewers: {
          type: 'array',
          description: 'The names of reviewers to request.',
          items: {
            type: 'string'
          },
          minItems: 1
        }
      },
      required: ['owner', 'repo', 'pull_number', 'reviewers']
    }
  },
  {
    name: createReview.name,
    description:
      'Create a review for a pull request. User can only have one pending review per pull request not file. The comments must be for a difference (`patch`) in the `listPRFiles` response.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        },
        body: {
          type: 'string',
          description: 'when using REQUEST_CHANGES or COMMENT for the event parameter. The body text of the pull request review.'
        },
        event: {
          type: 'string',
          description: 'The review action you want to perform. The review actions include: APPROVE, REQUEST_CHANGES, or COMMENT.',
          enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']
        },
        comments: {
          type: 'array',
          description: 'Array of comments. Create a review comment using line, side, and optionally start_line and start_side if your comment applies to more than one line in the pull request diff',
          items: {
            type: 'object',
            properties: {
              body: {
                type: 'string',
                description: 'The text of the review comment.'
              },
              path: {
                type: 'string',
                description: 'The relative path to the file that necessitates a comment.'
              },
              side: {
                type: 'string',
                description: 'In a split diff view, the side of the diff that the pull request\'s changes appear on. Can be LEFT or RIGHT. Use LEFT for deletions that appear in red. Use RIGHT for additions that appear in green or unchanged lines that appear in white and are shown for context. For a multi-line comment, side represents whether the last line of the comment range is a deletion or addition.'
              },
              line: {
                type: 'integer',
                description: 'Required unless using subject_type:file. The line of the blob in the pull request diff(which can be obtained from the `listPRFiles` function) that the comment applies to. For a multi-line comment, the last line of the range that your comment applies to.'
              },
              start_line: {
                type: 'integer',
                description: 'Required when using multi-line comments unless using in_reply_to. The start_line is the first line in the pull request diff that your multi-line comment applies to. start line must precede the end line.'
              },
              start_side: {
                type: 'string',
                description: 'Required when using multi-line comments unless using in_reply_to. The start_side is the starting side of the diff that the comment applies to. Can be LEFT or RIGHT.'
              }
            }
          },
          minItems: 1,
          required: ['body', 'path']
        }
      },
      required: ['owner', 'repo', 'pull_number', 'comments', 'event']
    }
  },
  {
    name: listIssueComments.name,
    description:
      'Lists all issue comments for a pull request or issue. Issue comments are in ascending order by ID.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        issue_number: {
          type: 'integer',
          description: 'The number that identifies the pull request or issue.'
        }
      },
      required: ['owner', 'repo', 'issue_number']
    }
  },
  {
    name: createIssueComments.name,
    description:
      'Create issue comments for a pull request or issue.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        issue_number: {
          type: 'integer',
          description: 'The number that identifies the pull request or issue.'
        },
        body: {
          type: 'string',
          description: 'The contents of the comment.'
        }
      },
      required: ['owner', 'repo', 'issue_number', 'body']
    }
  },
  {
    name: addLabels.name,
    description:
      'Adds labels to the pull request or issue. If you provide an empty array of labels, all labels are removed.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        issue_number: {
          type: 'integer',
          description: 'The number that identifies the pull request or issue.'
        },
        labels: {
          type: 'array',
          description: 'The names of the labels to add to the issue\'s existing labels.',
          items: {
            type: 'string'
          }
        }
      },
      required: ['owner', 'repo', 'issue_number', 'labels']
    }
  },
  {
    name: listCommits.name,
    description:
      'Lists a maximum of 250 commits for a pull request.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        pull_number: {
          type: 'integer',
          description: 'The number that identifies the pull request.'
        }
      },
      required: ['owner', 'repo', 'pull_number']
    }
  },
  {
    name: getContents.name,
    description:
      'Gets the contents of a file or directory in a repository.',
    parameters: {
      type: 'object',
      properties: {
        ...baseProps,
        path: {
          type: 'string',
          description: 'The path from repository root.'
        },
        ref: {
          type: 'string',
          description:
            'The name of the commit/branch/tag. Default: the repository’s default branch. If you want to see the contents in pull request, specify the pull request branch.'
        }
      },
      required: ['owner', 'repo', 'path']
    }
  }
];
