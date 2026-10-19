import 'package:flutter/material.dart';

import '../models.dart';
import '../widgets.dart';

class PerspectiveScreen extends StatelessWidget {
  const PerspectiveScreen({super.key, required this.story, required this.perspective});

  final StoryDetail story;
  final Perspective perspective;

  @override
  Widget build(BuildContext context) {
    final muted = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13.5);
    final others = story.summary.perspectives.where((p) => p != perspective).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Perspective'), leading: const BackButton()),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [const AiTag(), Text(perspective.label, style: muted)]),
            const SizedBox(height: 12),
            InfoCard(title: perspective.label, child: Text(perspective.summary)),
            InfoCard(
              title: 'Evidence and limits',
              child: Text(
                'This is an attributed viewpoint summarized by AI, not a statement of fact. ${perspective.evidenceLimits}',
              ),
            ),
            const SectionHeader('Supporting coverage'),
            for (final (i, id) in perspective.articleIds.indexed)
              if (story.articleById(id) case final a?)
                ActionTile(label: '[${i + 1}] ${a.publisherName}', subtitle: a.title, action: 'Open', onTap: () => openExternal(context, a.url)),
            if (others.isNotEmpty) ...[
              const SectionHeader('Other perspectives'),
              for (final p in others)
                ActionTile(
                  label: p.label,
                  action: 'Switch',
                  onTap: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => PerspectiveScreen(story: story, perspective: p))),
                ),
            ],
            const SizedBox(height: 8),
            Text('Only viewpoints reported in the coverage are shown. Opposition is never invented to fill a button.', style: muted),
          ],
        ),
      ),
    );
  }
}
