// with pieces and references from:
//  - https://github.com/tree-sitter/tree-sitter-javascript/blob/master/grammar.js
//  - https://github.com/tree-sitter/tree-sitter-java/blob/master/grammar.js
//  - https://github.com/stadelmanma/tree-sitter-fortran/blob/master/grammar.js

module.exports = grammar({
	name: 'unrealscript',

	extras: $ => [
		$.comment,
		/\s/,
	],

	supertypes: $ => [
		$.statement,
		$.declaration,
		$.expression,
		$.primary_expression,
	],

	inline: $ => [
		$.statement,
		$._expression,
		$._identifier,
		$._lhs_expression
	],

	precedences: $ => [
		[
			'member',
			'call',
			$.update_expression,
			'unary_void',
			'binary_exp',
			'binary_times',
			'binary_plus',
			'binary_shift',
			'binary_compare',
			'binary_relation',
			'binary_equality',
			'bitwise_and',
			'bitwise_xor',
			'bitwise_or',
			'logical_and',
			'logical_or',
			'concat',
			'vector_operation',
			$._statement
		],
		[$.reference, $.primary_expression],
		['assign', $.primary_expression],
		['member', 'new', 'call', $.expression],
		['declaration', 'literal'],
		[$.primary_expression, $.block],
		[$.struct_value, $.expression],
		[$.number, $.array_identifier, $._identifier],
		[$.primary_expression, $.nested_identifier, $.member_expression],
	],

	conflicts: $ => [
		[$.primary_expression, $.new_expression],
		[$.state_modifier, $.function_modifier],
		[$.primary_expression],
		// UE3: 'const' is both a const-decl keyword and a function
		// specifier (trailing const, const funcs).
		[$.constant_declaration, $.function_modifier],
		// '(X=1)' in a defaultproperties value is a struct literal, not a
		// parenthesized assignment: bias with dynamic precedence.
		[$.struct_value, $.parenthesized_expression],
	],

	word: $ => $.identifier,

	rules: {
		program: $ => repeat(choice($.exec_directive, $.backtick_macro, $.statement)),

		// Backtick macro lines (UE3 `include, `define, `log, `if, ...):
		// skipped as opaque tokens anywhere a statement is valid — top
		// level, function/state bodies, defaultproperties.
		backtick_macro: _ => token(seq('`', /[^\n]*/)),

		declaration: $ => choice(
			$.class_declaration,
			$.state_declaration,
			$.function_declaration,
			$.operator_declaration,
			$.variable_declaration,
			$.constant_declaration,
			$.enum_declaration,
			$.struct_declaration,
			$.replication_block,
			$.defaultproperties,
			$.struct_default_properties,
			$.cpp_text,
			$.struct_cpp_text,
		),

		// Opaque balanced-brace block for 'cpptext { <raw C++> }':
		// the C++ is not UnrealScript, so swallow without structure.
		cpp_text: $ => seq(
			caseInsensitive('cpptext'),
			'{',
			repeat(choice($._cpp_chunk, $._cpp_preproc)),
			'}',
		),
		_cpp_chunk: $ => choice(
			/[^^{}]+/,
			seq('{', repeat($._cpp_chunk), '}'),
		),
		// C++ preprocessor lines inside cpptext: swallow to end of line so
		// '#' never starts an UnrealScript directive mid-block. Also the
		// bare '#' token (e.g. a lone '#' separator line some licensees
		// emit): [^\n]* matches empty.
		_cpp_preproc: _ => token(seq('#', /[^\n]*/)),
		struct_cpp_text: $ => seq(
			caseInsensitive('structcpptext'),
			'{',
			repeat($._cpp_chunk),
			'}',
		),

		// UE3 structdefaultproperties { ... }: struct-level defaults
		// (EliotVU UCParser.g4 structDefaultPropertiesBlock). Same member
		// shape as defaultproperties.
		struct_default_properties: $ => prec.right(seq(
			caseInsensitive('structdefaultproperties'),
			'{',
			repeat($._defaultproperties_properties),
			'}',
			optional(';'),
		)),

		class_declaration: $ => seq(
			caseInsensitive('class'),
			field('name', $.identifier),
			optional($._declaration_heritage),
      optional($._imports_modifier),
			field('modifiers', repeat($.class_modifier)),
			';',
		),

		exec_directive: $ => seq(
			field('directive', token(/#[^\s]+/)),
			field('kind', $.identifier),
			field('operation', $.identifier),
			field('arguments', /[^\n]+/),
			'\n'
		),

		state_declaration: $ => seq(
			field('modifiers', repeat($.state_modifier)),
			caseInsensitive('state'), optional(seq('(', ')')),
			field('name', $.identifier),
			optional($._declaration_heritage),
			field('body', $.state_body),
		),
		state_body: $ => prec.right(seq(
			'{',
			field('ignores', optional($._state_ignores)),
			repeat($._statement),
			'}'
		)),
		_state_ignores: $ => seq(
			caseInsensitive('ignores'),
			commaSep1($.identifier),
			';'
		),

	function_declaration: $ => seq(
			field('modifiers', repeat($.function_modifier)),
			choice(caseInsensitive('function'), caseInsensitive('event'), caseInsensitive('delegate')),
			optional(field('return_type', $.function_return_type)),
			field('name', $.identifier),
			field('parameters', $.function_parameters),
			choice(field('body', $.block), ';'),
		),

		// Return type with optional leading 'coerce' (EliotVU
		// returnTypeModifier; e.g. simulated function coerce string
		// GetStringRepresentation(...)).
		function_return_type: $ => seq(
			optional(caseInsensitive('coerce')),
			$.type,
		),

		// Latent state-code labels (Begin:, EndState:, etc.) and stray
		// identifiers followed by a colon inside state bodies are labels,
		// not declarations. A label also terminates the preceding statement
		// list cleanly so error recovery stays local.

		operator_declaration: $ => seq(
			field('modifiers', repeat($.function_modifier)),
			choice(
				seq(caseInsensitive('operator'), '(', optional(field('precedence', $.uint)),')',),
				caseInsensitive('preoperator'),
				caseInsensitive('postoperator'),
			),
			field('return_type', optional($.type)),
			field('operator', $.operator_name),
			field('parameters', $.function_parameters),
			choice(field('body', $.block), ';'),
		),
		operator_name: $ => choice(
			$.identifier,
			/[\^!$%&/?*+~@\-><|=]+/,
		),

		if_statement: $ => prec.right(seq(
			caseInsensitive('if'),
			field('condition', $.condition),
			field('consequence', $.statement),
			optional(seq(caseInsensitive('else'), field('alternative', $.statement))),
		)),

		condition: $ => seq('(', $.expression, ')'),

		replication_block: $ => seq(
			caseInsensitive('replication'),
			'{',
			repeat(seq(
				// UE3: the reliable/unreliable modifier is optional
				// (EliotVU replicationStatement: replicationModifier?).
				field('kind', optional(choice(caseInsensitive('unreliable'), caseInsensitive('reliable')))),
				caseInsensitive('if'),
				field('condition', $.condition),
				field('consequence', commaSep1($.identifier)),
				';',
			)),
			'}',
		),

		defaultproperties: $ => seq(
			caseInsensitive('defaultproperties'),
			'{',
			repeat($._defaultproperties_properties),
			'}',
		),
		// UE3 defaultproperties members (EliotVU defaultStatement): plain
		// assignments, member-call statements (Prop.Add(...)), standalone
		// Begin Object blocks, and backtick macros. No trailing-newline
		// requirement: assignments are self-delimiting, which keeps error
		// recovery local when one line fails.
		_defaultproperties_properties: $ => choice(
			$.default_property_assignment,
			$.default_object_block,
			$.default_member_call,
			$.backtick_macro,
			';',
		),
		default_property_assignment: $ => prec.right('assign', seq(
			field('property', $.identifier),
			field('index', optional(seq(choice('(', '['), $.uint, choice(']', ')')))),
			'=',
			field('value', choice(
				$.primary_expression,
				// class'Foo' object literal (keyword token, not identifier —
				// the generic `reference` rule cannot match; EliotVU
				// objectLiteral). NOTE: bare `2` (uint) does NOT parse as
				// primary_expression in this position — allow it directly
				// (e.g. DamageWeaponFireMode=2).
				$.uint,
				seq(caseInsensitive('class'), $.name),
				$.default_object_block,
				$.struct_value,
				$.brace_struct_value,
			)),
		)),
		// Member calls as defaultproperties statements. Corpus survey of
		// 3,760 blocks: call receivers are Ident or Ident.Ident only
		// (0 two-dot receivers, 0 dotted assignment LHS), so both object
		// forms are written out explicitly — no repeat, LR(1)-safe.
		//   Components.Add(...)
		//   StatNameToStatIdMapping.Add(...)   (one-dot receiver)
		//   VariableLinks.Empty                (bare clear, no args/parens)
		//   SpawnableData.Add(( A=1 ))       (extra-wrapped args: wrapped
		//     FIRST — after the method name both '(' (args) and '((...))'
		//     (wrapped) are possible; LR(1) decides by explicit order)
		default_member_call: $ => prec(1, seq(
			field('object', seq(
				$.identifier,
				optional(seq('.', $.identifier)),
			)),
			'.',
			field('method', $.identifier),
			optional(choice(
				seq(
					'(',
					'(',
					commaSep(optional($.expression)),
					')',
					')',
				),
				seq(
					field('index', seq(choice('(', '['), $.uint, choice(']', ')'))),
					field('arguments', optional($.arguments)),
				),
				field('arguments', $.arguments),
			)),
		)),
		// Standalone subobject block:
		//   Begin Object Class=SpriteComponent Name=Sprite ... End Object
		default_object_block: $ => seq(
			caseInsensitive('begin'),
			caseInsensitive('object'),
			// UE3 subobject props are ';'-terminated (Constant=1.0f;),
			// unlike top-level defaultproperties lines.
			repeat(choice(
				seq($.default_property_assignment, optional(';')),
				$.backtick_macro,
			)),
			caseInsensitive('end'),
			caseInsensitive('object'),
		),
		_default_property_value: $ => choice(
			$.primary_expression,
			$.uint,
			// class'Foo' object literal (see assignment value note).
			seq(caseInsensitive('class'), $.name),
			$.default_object_block,
			$.struct_value,
			$.brace_struct_value,
		),
		// class'Foo', Texture2D'Bar', soundcue'Baz': the existing
		// `reference` rule (identifier + name literal, EliotVU
		// objectLiteral) already covers these in primary_expression.
		struct_value: $ => prec.dynamic(1, seq(
			'(',
				commaSep(seq(
					field('left', seq(
						$.identifier,
						// UE3 subscript LHS in struct literals:
						// (AnimName[BS_STD_UP]="x", ...)
						optional($.array_dimensions),
					)),
					'=',
					field('right', choice(
						$.primary_expression,
						$.uint,
						// class'Foo' object literal (see assignment value).
						seq(caseInsensitive('class'), $.name),
						$.default_object_block,
						$.struct_value,
						$.brace_struct_value,
					)),
				)),
			')'
		)),
		// UE3 brace struct literal in defaultproperties:
		//   ViewOffset={(
		//     OffsetHigh=(X=-1200,Y=0,Z=0),
		//     ...
		//   )}
		// Same shape as the paren form, brace-delimited; inner items may
		// themselves be brace structs ({(...)}), paren structs, or plain
		// values, with optional trailing comma.
		brace_struct_value: $ => seq(
			'{',
				optional(commaSep1(choice(
					seq(
						field('left', seq(
							$.identifier,
							optional($.array_dimensions),
						)),
						'=',
						field('right', choice(
							$.primary_expression,
							$.uint,
							// class'Foo' object literal (see assignment value).
							seq(caseInsensitive('class'), $.name),
							$.default_object_block,
							$.struct_value,
							$.brace_struct_value,
						)),
					),
					$.struct_value,
					$.brace_struct_value,
					$.primary_expression,
				))),
				optional(','),
			'}'
		),

		for_statement: $ => seq(
			caseInsensitive('for'), '(',
			field('init', optional($.expression)), ';',
			field('condition', optional($.expression)), ';',
			field('update', optional($.expression)), ')',
			field('body', $.statement),
		),

		// UE3 iterators: AllActors(class'X', P), TouchingActors(...),
		// WorldInfo.AllControllers(...). The head is almost always a call
		// or member chain, so parse it as primary expressions (no bare
		// binary operators): EliotVU foreachStatement takes a
		// primaryExpression, and iterator args live in the call's argument
		// list anyway.
		// UE3 iterators: AllActors(class'X', P), TouchingActors(...),
		// WorldInfo.AllControllers(...). Only call-shaped heads are
		// supported (bare-identifier iterators do not occur in the corpus):
		//   foreach AllActors(class'P', P) { ... }
		//   foreach WorldInfo.AllControllers(class'PC', PC) { ... }
		// The iterator call is inlined here (not call_expression) because
		// an outer call_expression alternative would be LR-ambiguous with
		// member_expression at generate time.
		foreach_iterator_call: $ => prec(10, seq(
			caseInsensitive('foreach'),
			// Head can be Ident(args), Member(args), or a call result
			// followed by .Member(args): GetWorldInfo().AllControllers(..).
			field('function', choice(
				$.identifier,
				$.member_expression,
				seq($.call_expression, '.', $.identifier),
			)),
			field('arguments', $.arguments),
			field('body', $.statement),
		)),

		while_statement: $ => seq(
			caseInsensitive('while'),
			field('condition', $.condition),
			field('body', $.statement),
		),

		do_until_statement: $ => seq(
			caseInsensitive('do'),
			field('body', $.statement),
			caseInsensitive('until'), '(', field('condition', $.expression), ')',
			';',
		),

		switch_statement: $ => seq(
			caseInsensitive('switch'),
			'(', field('condition', $.expression), ')',
			field('rules', $.switch_body),
		),
		switch_body: $ => seq(
			'{',
				repeat($.switch_rule),
			'}',
		),
		switch_rule: $ => prec.left(seq(
			$.switch_condition,
			repeat($.statement),
		)),
		switch_condition: $ => seq(
			choice(
				seq(caseInsensitive('case'), $.expression),
				caseInsensitive('default'),
			),
			':',
		),

		return_statement: $ => seq(
			caseInsensitive('return'),
			optional($.expression),
			';'
		),

		continue_statement: _ => seq(
			caseInsensitive('continue'),
			';'
		),

		break_statement: _ => seq(
			caseInsensitive('break'),
			';'
		),

		assert_statement: $ => seq(
			caseInsensitive('assert'), '(', field('condition', $.expression), ')',
			';'
		),

		enum_declaration: $ => seq(
			$._enum_declaration,
			';'
		),
		_enum_declaration: $ => seq(
			caseInsensitive('enum'),
			field('name', $.identifier),
			field('body', $.enum_body),
		),
		enum_body: $ => seq(
			'{',
			commaSep1($.identifier),
			optional(','),
			'}',
		),

		// UE3 struct modifiers (EliotVU UCParser.g4 structModifier, gen 3):
		// struct native transient ExportedStruct { ... };
		struct_declaration: $ => seq(
			caseInsensitive('struct'),
			field('modifiers', repeat($.struct_modifier)),
			field('name', $.identifier),
			optional(seq(
				caseInsensitive('extends'),
				field('parent', $.identifier),
			)),
			field('body', $.struct_body),
			// UE3 form is `};` (340 corpus hits); the trailing ';' lives
			// here so struct_body stays clean for the upstream test.
			';',
		),
		struct_modifier: $ => choice(
			caseInsensitive('native'),
			caseInsensitive('transient'),
			caseInsensitive('export'),
			caseInsensitive('init'),
			caseInsensitive('atomic'),
			caseInsensitive('atomicwhencooked'),
			caseInsensitive('immutable'),
			caseInsensitive('immutablewhencooked'),
			caseInsensitive('strictconfig'),
			caseInsensitive('long'),
			// licensee fallback, mirroring unidentifiedModifier
			$._unidentified_modifier,
		),
		struct_body: $ => prec.right(seq(
			'{',
			repeat(choice(
				$.variable_declaration,
				$.constant_declaration,
				$.cpp_style_declaration,
				$.struct_cpp_text,
				$.struct_default_properties,
				$.backtick_macro,
			)),
			'}',
		)),

		constant_declaration: $ => seq(
			caseInsensitive('const'),
			$.assignment_expression,
			';',
		),

		variable_declaration: $ => seq(
			choice(
				$._class_variable_declaration,
				$._enum_variable_declaration,
			),
			';',
		),

		_class_variable_declaration: $ => prec.left(seq(
			caseInsensitive('var'),
			field('editgroups', optional(seq('(', commaSep($._identifier), ')'))),
			field('modifiers', repeat($.variable_modifier)),
			field('type', $.type),
			commaSep1(field('name', choice($._identifier, $.array_identifier))),
		)),

		_enum_variable_declaration: $ => seq(
			caseInsensitive('var'),
			field('editorgroups', optional(seq('(', commaSep($._identifier), ')'))),
			field('modifiers', repeat($.variable_modifier)),
			$._enum_declaration,
			commaSep1(field('name', choice($._identifier, $.array_identifier))),
		),

		local_variable_declaration: $ => seq(
			caseInsensitive('local'),
			field('type', $.type),
			commaSep1(field('name', choice($._identifier, $.array_identifier))),
			';',
		),

		// UE3 C++-style native declarations inside struct bodies (e.g.
		// ContentTagIndex.uc): 'static UContentTagIndex*
		// GetLocalContentTagIndex();'. Opaque: punctuated type tokens +
		// name + parens + ';'. Matches only when the line contains '*' or
		// C++ scope '::' so plain UnrealScript locals never take it.
		cpp_style_declaration: $ => token(seq(
			/[^;\n{}]*[*][^;\n{}]*/,
			';',
		)),

		_config_modifier: $ => seq(
			caseInsensitive('config'),
			optional(seq(
				'(',
				optional($.identifier),
				')'
			)),
		),
    _imports_modifier: $ => seq(
      caseInsensitive('imports'),
      seq(
        '(',
        field('import', optional($.identifier)),
        ')'
      ),
    ),
    	_native_modifier: $ => seq(
			caseInsensitive('native'),
			optional(seq(
				'(',
				field('token', optional(choice($.uint, $.identifier, $.string))),
				')'
			)),
		),

		_native_only_modifier: $ => prec(1, seq(
			caseInsensitive('native'),
			'(',
			field('token', optional(choice($.uint, $.identifier, $.string))),
			')',
		)),

		_class_depends_modifier: $ => seq(
			caseInsensitive('dependson'),
			optional(seq(
				'(',
				commaSep1($.identifier),
				')'
			)),
		),

		_class_within_modifier: $ => seq(
			caseInsensitive('within'),
			choice($.nested_identifier, $.identifier),
		),

		// UE3 (EliotVU UCParser.g4 classModifier): licensees add custom
		// modifiers constantly, so accept any identifier + args instead of
		// failing the whole class header (unidentifiedModifier). The args
		// are REQUIRED: otherwise a bare identifier is ambiguous with the
		// declaration's type (LR(1) cannot decide `var Foo Bar;`). Bare
		// licensee modifiers without parens remain unsupported.
		_unidentified_modifier: $ => seq(
			$.identifier,
			seq('(', /[^)]*/, ')'),
		),

		_class_display_categories_modifier: $ => seq(
			choice(caseInsensitive('hidecategories'), caseInsensitive('showcategories')),
			optional(seq(
				'(',
				commaSep($.identifier),
				')'
			)),
		),

		class_modifier: $ => choice(
			// native(X) with parens binds tighter than the bare keyword
			// (native(AI) class modifier vs a type named by identifier).
			$._native_only_modifier,
			// Bare native (no parens): legal UE3, 714 corpus hits, but
			// ambiguous with a type named 'native' in var position only —
			// class headers have no type, so the bare keyword is safe HERE
			// (kept OUT of variable_modifier/function_modifier where the
			// parens form + identifier disambiguate instead).
			caseInsensitive('native'),
			caseInsensitive('abstract'),
			caseInsensitive('notplaceable'),
			choice(caseInsensitive('nativereplication'), caseInsensitive('nonativereplication')),
			caseInsensitive('safereplace'),
			caseInsensitive('perobjectconfig'),
			caseInsensitive('transient'),
			caseInsensitive('noexport'),
			caseInsensitive('exportstructs'),
			caseInsensitive('cacheexempt'),
			caseInsensitive('hidedropdown'),
			caseInsensitive('parseconfig'),
			caseInsensitive('instanced'),
			choice(caseInsensitive('collapsecategories'), caseInsensitive('dontcollapsecategories')),
			choice(caseInsensitive('placeable'), caseInsensitive('notplaceable')),
			choice(caseInsensitive('editinlinenew'), caseInsensitive('noteditinlinenew')),
       $._config_modifier,
			$._class_depends_modifier,
			$._class_within_modifier,
			// UE3 additions (EliotVU UCParser.g4 classModifier, gen 3):
			caseInsensitive('deprecated'),
			caseInsensitive('nativeonly'),
			caseInsensitive('perobjectlocalized'),
			caseInsensitive('dllbind'),
			seq(caseInsensitive('classgroup'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('inherits'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('implements'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('hidecategories'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('showcategories'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('autoexpandcategories'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('autocollapsecategories'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('dontautocollapsecategories'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('dontsortcategories'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('forcescriptorder'), optional(seq('(', /[^)]*/, ')'))),
			seq(caseInsensitive('classredirect'), optional(seq('(', /[^)]*/, ')'))),
			// licensee fallback LAST: any other identifier + optional args.
			$._unidentified_modifier
		),

		variable_modifier: $ => choice(
			caseInsensitive('static'),
			caseInsensitive('private'),
			caseInsensitive('public'),
			caseInsensitive('protected'),
			caseInsensitive('protectedwrite'),
			caseInsensitive('privatewrite'),
			caseInsensitive('const'),
			caseInsensitive('editconst'),
			caseInsensitive('transient'),
			caseInsensitive('deprecated'),
			caseInsensitive('input'),
			caseInsensitive('localized'),
			caseInsensitive('travel'),
			caseInsensitive('native'),
			caseInsensitive('export'),
			caseInsensitive('noexport'),
			caseInsensitive('globalconfig'),
			// UE3 additions (EliotVU variableModifier, gen 3):
			caseInsensitive('init'),
			caseInsensitive('edithide'),
			caseInsensitive('editfixedsize'),
			caseInsensitive('editoronly'),
			caseInsensitive('editortextbox'),
			caseInsensitive('noclear'),
			caseInsensitive('noimport'),
			caseInsensitive('serializetext'),
			caseInsensitive('nontransactional'),
			caseInsensitive('instanced'),
			caseInsensitive('databinding'),
			caseInsensitive('duplicatetransient'),
			caseInsensitive('repretry'),
			caseInsensitive('repnotify'),
			caseInsensitive('interp'),
			caseInsensitive('notforconsole'),
			caseInsensitive('archetype'),
			caseInsensitive('crosslevelactive'),
			caseInsensitive('crosslevelpassive'),
			caseInsensitive('allowabstract'),
			$._config_modifier,
			// licensee fallback LAST.
			$._unidentified_modifier,
		),

		state_modifier: _ => choice(
			caseInsensitive('auto'),
			caseInsensitive('simulated'),
		),

		function_modifier: $ => choice(
			// native(...) with parens binds tighter than the bare keyword
			// (native Timer() state functions vs the native modifier).
			$._native_only_modifier,
			caseInsensitive('static'),
			caseInsensitive('private'),
			caseInsensitive('public'),
			caseInsensitive('protected'),
			caseInsensitive('simulated'),
			caseInsensitive('singular'),
			caseInsensitive('final'),
			caseInsensitive('latent'),
			caseInsensitive('iterator'),
			caseInsensitive('exec'),
			// UE3 replication/role specifiers (EliotVU functionSpecifier):
			caseInsensitive('reliable'),
			caseInsensitive('unreliable'),
			caseInsensitive('server'),
			caseInsensitive('client'),
			caseInsensitive('demorecording'),
			caseInsensitive('dllimport'),
			caseInsensitive('virtual'),
			caseInsensitive('const'),
			caseInsensitive('noexport'),
			caseInsensitive('noexportheader'),
			caseInsensitive('transient'),
			caseInsensitive('k2call'),
			caseInsensitive('k2pure'),
			caseInsensitive('k2override'),
			$._native_modifier,
			// licensee fallback LAST.
			// NOTE: the call-shaped fallback ($._unidentified_modifier,
			// 'ident(args)') is deliberately ABSENT here. A function
			// modifier position followed by ident+parens is exactly a
			// call head ('F1(a+b)'), so the fallback shadowed every
			// call_expression in statement position. Unknown function
			// modifiers remain unsupported; class/var modifiers keep the
			// fallback, where no call head can follow. (Verified by
			// parsing the full 4,327-file GoW2 corpus with/without it.)
		),

		parameter_modifier: _ => choice(
			caseInsensitive('out'),
			caseInsensitive('optional'),
			caseInsensitive('coerce'),
			caseInsensitive('skip'),
			// UE3: 'const out Type Name' is pervasive (e.g. const out
			// InputEventParameters). EliotVU paramModifier likewise.
			caseInsensitive('const'),
		),

		function_parameters: $ => seq(
			'(',
			commaSep(
				seq(
					repeat($.parameter_modifier),
					field('type', $.type),
					field('name', $.identifier),
					// UE3 optional default values: function F(optional int X=3)
					optional(seq('=', $.expression)),
				)
			),
			')',
			// UE3 trailing const: function F() const;
			optional(caseInsensitive('const')),
		),

		_declaration_heritage: $ => seq(
			choice(caseInsensitive('extends'), caseInsensitive('expands')),
			field('parent', $.identifier)
		),

		block: $ => prec.right(seq(
			'{',
			repeat($._statement),
			'}'
		)),

 	label: $ => seq(
 		$.identifier, ':',
 	),
 	_statement: $ => choice(
 		$.local_variable_declaration,
 		$.statement,
 	),

 	statement: $ => choice(
 		$.block,
 		$.declaration,
 		$.backtick_macro,
 		$.expression_statement,
 		$.if_statement,
 		$.for_statement,
 		$.while_statement,
 		$.do_until_statement,
 		$.foreach_iterator_call,
 		$.switch_statement,
 		$.continue_statement,
 		$.break_statement,
 		$.stop_statement,
 		$.goto_statement,
 		$.assert_statement,
 		$.return_statement,
 		$.label,
 	),

 	// 'goto Label;' and 'stop;' only. GotoState('X') / Goto('X') are
 	// ordinary latent function calls (call_expression): the paren form
 	// is accepted HERE (not as a call) so latent gotos stay local
 	// instead of erroring.
 	goto_statement: $ => seq(
 		caseInsensitive('goto'),
 		// UE3 latent 'Goto('X')' accepted TOGETHER with the call reading:
 		// keep the paren form FIRST so the goto token wins over a generic
 		// call_expression at statement start.
 		choice(
 			seq('(', field('label', choice($.identifier, $.name)), ')'),
 			field('label', choice($.identifier, $.name)),
 		),
 		';',
 	),
 	stop_statement: _ => seq(
 		caseInsensitive('stop'),
 		';'
 	),

    	expression_statement: $ => seq(
			$._expression,
			';',
		),

		arguments: $ => seq(
			'(',
			commaSep(optional($.expression)),
			')',
		),

		expression: $ => choice(
			$.primary_expression,
			$.assignment_expression,
			$.augmented_assignment_expression,
			$.unary_expression,
			$.binary_expression,
			$.update_expression,
			$.string_expression,
			$.new_expression,
		),

		primary_expression: $ => choice(
			$.subscript_expression,
			$.member_expression,
			$.call_expression,
			$.parenthesized_expression,
			$.self,
			$.super,
			$.default,
			$.global,
			$._literal,
			$._identifier,
		),

		_expression: $ => choice(
			$.expression,
		),
		_lhs_expression: $ => choice(
			$.member_expression,
			$.subscript_expression,
			$._identifier,
		),
		assignment_expression: $ => prec.right('assign', seq(
			field('left', choice($.parenthesized_expression, $._lhs_expression)),
			'=',
			field('right', $.expression),
		)),
		_augmented_assignment_lhs: $ => choice(
			$.member_expression,
			$.subscript_expression,
			$.identifier,
			$.parenthesized_expression,
		),
		augmented_assignment_expression: $ => prec.right('assign', seq(
			field('left', $._augmented_assignment_lhs),
			field('operator', choice('+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=', '>>=', '>>>=',
				'<<=', '**=', '&&=', '||=', '??=')),
			field('right', $.expression),
		)),
		new_expression: $ => prec.right('new', seq(
			caseInsensitive('new'),
			optional(seq(
				'(',
					field('outer', $._identifier),
				')'
			)),
			field('type', $.primary_expression),
		)),

		binary_expression: $ => choice(
			...[
				['&&', 'logical_and'],
				['||', 'logical_or'],
				['>>', 'binary_shift'],
				['<<', 'binary_shift'],
				['&', 'bitwise_and'],
				['^', 'bitwise_xor'],
				['|', 'bitwise_or'],
				['+', 'binary_plus'],
				['-', 'binary_plus'],
				['*', 'binary_times'],
				['/', 'binary_times'],
				['%', 'binary_times'],
				['**', 'binary_exp', 'right'],
				['<', 'binary_relation'],
				['<=', 'binary_relation'],
				['==', 'binary_equality'],
				['!=', 'binary_equality'],
				['~=', 'binary_equality'],
				['>=', 'binary_relation'],
				['>', 'binary_relation'],
				[caseInsensitive('dot'), 'vector_operation'],
				[caseInsensitive('cross'), 'vector_operation'],
			].map(([operator, precedence, associativity]) =>
				(associativity === 'right' ? prec.right : prec.left)(precedence, seq(
					field('left', $.expression),
					field('operator', operator),
					field('right', $.expression),
				)),
			),
		),

		unary_expression: $ => choice(...[
			['+', 10],
			['-', 10],
			['!', 10],
			['~', 10],
			// UE3 pre-increment/decrement as unary: ++i, --j common in
			// for-loop updates (i+=2 was covered; ++i was not).
			['++', 10],
			['--', 10],
		].map(([operator, precedence]) =>
			prec.left(precedence, seq(
				field('operator', operator),
				field('operand', $.expression)
			))
		)),

		update_expression: $ => prec.left(choice(
			seq(
				field('argument', $.expression),
				field('operator', choice('++', '--')),
			),
			seq(
				field('operator', choice('++', '--')),
				field('argument', $.expression),
			),
		)),

		string_expression: $ => choice(
			...[
				['@', 'concat'],
				['$', 'concat'],
			].map(([operator, precedence]) =>
				prec.left(precedence, seq(
					field('left', $.expression),
					field('operator', operator),
					field('right', $.expression),
				)),
			),
		),

		type: $ => choice(
			$.primitive_type,
			$.native_type,
			$.dynamic_array,
			$.class_type,
			$.delegate_type,
			// UE3 dotted type refs: var GearPawn.BodyStance X; (nested
			// identifier covers Class.Member).
			$.nested_identifier,
			$.identifier,
		),

		// UE3: delegate<OnClicked> parameter/return types (EliotVU
		// delegateType; qualifiedIdentifier hardcoded to 2 levels there).
		delegate_type: $ => prec.right(seq(
			caseInsensitive('delegate'),
			optional(seq('<', $.nested_identifier, '>')),
		)),

		dynamic_array: $ => prec.right(seq(
			caseInsensitive('array'),
			'<', $.type, optional(seq(',', $.uint)), '>',
		)),
		class_type: $ => seq(
			caseInsensitive('class'),
			optional(seq('<', $.type, '>')),
		),
		// class'Foo': object literal. DISTINCT RULE (not inlined into
		// every value position): reference ALSO matches ident+name, so
		// both parse shapes are available and LR picks by context.
		class_literal: $ => seq(
			caseInsensitive('class'),
			$.name,
		),

		primitive_type: _ => choice(
			caseInsensitive('bool'),
			caseInsensitive('byte'),
			caseInsensitive('int'),
			caseInsensitive('float'),
			caseInsensitive('string'),
		),

		native_type: _$ => choice(
			caseInsensitive('vector'),
			caseInsensitive('rotator'),
		),

		_identifier: $ => prec.right(choice(
			$.identifier,
			$.nested_identifier,
			$.reference,
			$.default,
			$.self,
			$.super,
		)),

		identifier: _ => /[A-Za-z_]([A-Za-z0-9_]+)?/,

		array_identifier: $ => seq(
			$.identifier,
			$.array_dimensions,
		),

		array_dimensions: $ => repeat1(
			seq('[', field('size', $._expression), ']')
		),

		_literal: $ => choice(
			$.true,
			$.false,
			$.string,
			$.number,
			$.none,
			$.name
		),

		self: _ => caseInsensitive('self'),
		super: _ => caseInsensitive('super'),
		global: _ => caseInsensitive('global'),
		default: _ => caseInsensitive('default'),
		true: _ => caseInsensitive('true'),
		false: _ => caseInsensitive('false'),
		none: _ => caseInsensitive('none'),
		boolean: $ => choice(
			$.true,
			$.false,
		),

		string: $ => seq(
			'"',
				repeat(choice(
					alias($.unescaped_double_string_fragment, $.string_fragment),
					$.escape_sequence,
				)),
			'"',
		),
		unescaped_double_string_fragment: _ => token.immediate(prec(1, /[^"\\\r\n]+/)),
		unescaped_single_string_fragment: _ => token.immediate(prec(1, /[^'\\\r\n]+/)),
		// Bare ':' inside double-quoted strings (localized refs). A named
		// rule so it survives tokenization as its own leaf.
		colon_in_string: _ => ':',
		escape_sequence: _ => token.immediate('\\'),
		name: $ => prec.right(seq(
			'\'',
			optional($._identifier),
			'\'',
		)),
		reference: $ => seq(
			$.identifier,
			$.name,
		),

		uint: _ => token(/\d+/),

		number: _ => {
			const hex_literal = seq(
				choice('0x', '0X'),
				/[\da-fA-F](_?[\da-fA-F])*/,
			);
			const decimal_digits = /\d+/;
			const signed_integer = seq(optional(choice('-', '+')), decimal_digits);
			const exponent_part = seq(choice('e', 'E'));
			const decimal_integer_literal = choice(
				'0',
				seq(decimal_digits, optional(seq(optional('_'), decimal_digits))),
			);
			const decimal_literal = choice(
				seq(optional(choice('-', '+')), decimal_integer_literal, '.', optional(decimal_digits), optional(exponent_part), optional(/[fF]/)),
				seq('.', decimal_digits, optional(exponent_part), optional(/[fF]/)),
				seq(decimal_integer_literal, exponent_part, optional(/[fF]/)),
				decimal_digits,
			);
			return token(prec.left(choice(
				hex_literal,
				decimal_literal,
				signed_integer
			)));
		},

		member_expression: $ => prec('member', seq(
			field('object', choice($.expression, $.primary_expression)),
			'.',
			field('property', alias($.identifier, $.property_identifier)),
		)),
		nested_identifier: $ => prec('member', seq(
			field('object', choice($._identifier)),
			'.',
			field('property', alias($.identifier, $.property_identifier)),
		)),
		subscript_expression: $ => prec.right('member', seq(
			field('object', choice($.expression, $.primary_expression)),
			'[', field('index', $._expression), ']',
		)),
		parenthesized_expression: $ => seq(
			'(',
			$._expression,
			')',
		),
		call_expression: $ => choice(
			prec('call', seq(
				field('function', $.expression),
				field('arguments', $.arguments),
			)),
		),

		comment: _ => choice(
			token(choice(
				seq('//', /.*/),
				seq(
					'/*',
					/[^*]*\*+([^/*][^*]*\*+)*/,
					'/',
				),
			)),
		),
	}
});

/** stolen from FORTRAN xD */
function caseInsensitive (keyword, aliasAsWord = true) {
	let result = new RegExp(keyword
		.split('')
		.map(l => l !== l.toUpperCase() ? `[${l}${l.toUpperCase()}]` : l)
		.join('')
	)
	if (aliasAsWord) result = alias(result, keyword)
	return result
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @return {SeqRule}
 *
 */
function commaSep1(rule) {
	return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @return {ChoiceRule}
 *
 */
function commaSep(rule) {
	return optional(commaSep1(rule));
}
