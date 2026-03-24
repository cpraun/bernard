/*
 * Copyright 2026 Christoph von Praun
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

function MarkdownPreview({ content }: { content: string }): React.JSX.Element {
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    return <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{content}</Markdown>
  }
  const frontmatter = match[1]
  const body = content.slice(match[0].length)
  return (
    <>
      <pre className="frontmatter-block">{frontmatter}</pre>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{body}</Markdown>
    </>
  )
}

export default MarkdownPreview
