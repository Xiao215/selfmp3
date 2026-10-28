import { fireEvent, render, screen } from '@testing-library/react-native'

import { ClarifyAnswer } from './ClarifyAnswer'

/** Ask's question back: each option asks its own words as the next turn. */

const question = {
  kind: 'clarify' as const,
  question: 'Which gym do you mean?',
  options: ['add them to gym', 'add them to gym 2'],
}

it('asks an option’s words when it is pressed', async () => {
  const onAsk = jest.fn()
  await render(<ClarifyAnswer answer={question} onAsk={onAsk} />)
  await fireEvent.press(screen.getByLabelText('Ask: add them to gym 2'))
  expect(onAsk).toHaveBeenCalledWith('add them to gym 2')
  expect(onAsk).toHaveBeenCalledTimes(1)
})

it('shows only the question when there is no way to ask', async () => {
  await render(<ClarifyAnswer answer={question} />)
  expect(screen.queryAllByTestId('ask-clarify-option')).toHaveLength(0)
})
