//<nowiki>
( function ( AFCH, $, mw ) {
	$.extend( AFCH, {

		/**
		 * Log a string to the console
		 * @param {string} text
		 */
		log: function ( text ) {
			if ( AFCH.consts.beta ) {
				mw.log( 'AFCH: ' + text );
			}
		},

		/**
		 * Prepares the AFCH gadget by setting constants and checking environment
		 * @return {bool} Whether or not all setup functions executed successfully
		 */
		beforeLoad: function () {
			// Check requirements
			if ( 'ajax' in $.support && !$.support.ajax ) {
				AFCH.error = 'AFCH requires AJAX';
				return false;
			}

			if ( AFCH.consts.baseurl.indexOf( 'MediaWiki:Gadget-afch.js' ) === -1 ) {
				AFCH.consts.beta = true;
			}

			return true;
		},

		/**
		 * Loads the subscript
		 * @param {string} type Which type of script to load:
		 *                      'redirects' or 'ffu' or 'submissions'
		 */
		load: function ( type ) {
			AFCH.log( 'loading ' + type );

			// FIXME: we should load hogan.js "for real", figure out how to
			// add to ResourceLoader or something??
			mw.loader.load( AFCH.consts.baseurl + '/hogan.js' );

			if ( AFCH.consts.beta ) {
				// Load css
				mw.loader.load( AFCH.consts.scriptpath + '?action=raw&ctype=text/css&title=MediaWiki:Gadget-afch.css', 'text/css' );
				// Load dependencies
				mw.loader.load( [ 'mediawiki.feedback', 'mediawiki.api', 'jquery.chosen' ] );
			}

			// Set up all the other good things
			AFCH.afterLoad();

			// And finally load the subscript
			$.getScript( AFCH.consts.baseurl + '/' + type + '.js' );
		},

		/**
		 * Loads a bunch of necessary thingies, like prefs and the api and constants and unicorns!
		 */
		afterLoad: function () {
			// FIXME: Add real pref code
			AFCH.prefs = {};
			AFCH.api = new mw.Api();

			// Add more constants
			$.extend( AFCH.consts, {
				// Edit token used in api requests
				editToken: mw.user.tokens.get( 'editToken' ),
				// Full page name, "Wikipedia talk:Articles for creation/sandbox"
				pagename: mw.config.get( 'wgPageName' ).replace( '_', ' ' ),
				// Link to the current page, "/wiki/Wikipedia talk:Articles for creation/sandbox"
				pagelink: mw.util.getUrl(),
				// Used when status is disabled
				nullstatus: { update: function () { return; } }
			} );
		},

		/**
		 * Appends a feedback link to the given element
		 * @param {object} $element The jQuery element to which the link should be appended
		 * @param {string} type (optional) The part of AFCH that feedback is being given for, e.g. "files for upload"
		 */
		initFeedback: function ( $element, type ) {
			var feedback = new mw.Feedback( {
					title: new mw.Title( 'Wikipedia talk:Articles for creation/Helper script/Feedback' ),
					bugsLink: 'https://github.com/WPAFC/afch-rewrite/issues/new',
					bugsListLink: 'https://github.com/WPAFC/afch-rewrite/issues?state=open'
				} );
			$( '<span>' )
				.text( 'Give feedback!' )
				.addClass( 'afch-feedbackLink' )
				.click( function () {
					feedback.launch( {
						subject: type ? 'Feedback about ' + type : 'AFCH feedback',
						contents: 'Replace this with your error report or feedback, positive or negative. Please be as detailed as possible!'
					} );
				} )
				.appendTo( $element );
		},


		/**
		 * Represents a page, mainly a wrapper for various actions
		 */
		Page: function ( name ) {
			var pg = this;

			this.title = new mw.Title( name );
			this.rawTitle = this.title.getPrefixedText();

			this.additionalData = {};

			this.getText = function ( usecache ) {
				var deferred = $.Deferred();

				if ( usecache && pg.pageText ) {
					deferred.resolve( pg.pageText );
				}

				AFCH.actions.getPageText( this.rawTitle, { hide: true, moreProps: 'timestamp|user' } )
					.done( function ( pagetext, data ) {
						pg.pageText = pagetext;
						// Teehee, let's use this opportunity to get some data for later
						pg.additionalData.lastModified = new Date( data.timestamp );
						pg.additionalData.lastEditor = data.user;

						deferred.resolve( pg.pageText );
					} );

				return deferred;
			};

			this.edit = function ( options ) {
				var deferred = $.Deferred();

				AFCH.actions.editPage( this.rawTitle, options )
					.done( function ( data ) {
						deferred.resolve( data );
					} );

				return deferred;
			};

			this.getLastModifiedDate = function () {
				// FIXME: I guess the nice thing to do would be to make an API call if necessary.
				// But that seems like a huge pain and would require some more functionality. I'm
				// lazy. For now we just get the text first. Stupid, I know.
				var deferred = $.Deferred();
				pg.getText( true ).done( deferred.resolve( pg.additionalData.lastModified ) );
				return deferred;
			};

			this.getLastEditor = function () {
				var deferred = $.Deferred();
				pg.getText( true ).done( deferred.resolve( pg.additionalData.lastEditor ) );
				return deferred;
			};

		},

		/**
		 * Perform a specific action
		 */
		actions: {
			/**
			 * Gets the full wikicode content of a page
			 * @param {string} pagename The page to get the contents of, namespace included
			 * @param {object} options Object with properties:
			 *                          hide: {bool} set to true to hide the API request in the status log
			 *                          moreProps: {string} additional properties to request
			 * @return {$.Deferred} Resolves with pagetext and full data available as parameters
			 */
			getPageText: function ( pagename, options ) {
				var status, request, rvprop = 'content',
					deferred = $.Deferred();

				if ( !options.hide ) {
					status = new AFCH.status.Element( 'Getting $1...',
						{ '$1': $( '<a>' )
							.attr( 'href', mw.util.getUrl( pagename ) )
							.text( pagename.replace( /_/g, ' ' ) )
						} );
				} else {
					status = AFCH.consts.nullstatus;
				}

				if ( options.moreProps ) {
					rvprop += '|' + options.moreProps;
				}

				request = {
					action: 'query',
					prop: 'revisions',
					rvprop: rvprop,
					format: 'json',
					indexpageids: true,
					titles: pagename
				};

				AFCH.api.get( request )
					.done( function ( data ) {
						var rev, id = data.query.pageids[0];
						if ( id && data.query.pages ) {
							rev = data.query.pages[id].revisions[0];
							deferred.resolve( rev['*'], rev );
							status.update( 'Got $1' );
						} else {
							deferred.reject( data );
							// FIXME: get detailed error info from API result
							status.update( 'Error getting $1: ' + JSON.stringify( data ) );
						}
					} )
					.fail( function ( err ) {
						deferred.reject( err );
						status.update( 'Error getting $1: ' + JSON.stringify( err ) );
					} );

				return deferred;
			},

			/**
			 * Modifies a page's content
			 * @param {string} pagename The page to be modified, namespace included
			 * @param {object} options Object with properties:
			 *                          contents: {string} the text to add to/replace the page,
			 *                          summary: {string} edit summary, will have the edit summary ad at the end,
			 *                          createonly: {bool} set to true to only edit the page if it doesn't exist,
			 *                          mode: {string} 'appendtext' or 'prependtext'; default: (replace everything)
			 *                          patrol: {bool} by default true; set to false to not patrol the page FIXME
			 *                          hide: {bool} Set to true to supress logging in statusWindow
			 *                          statusText: {string} message to show in status; default: "Editing"
			 * @return {jQuery.Deferred} Resolves if saved with all data
			 */
			editPage: function ( pagename, options ) {
				var status, request, deferred = $.Deferred();

				if ( !options ) {
					options = {};
				}

				if ( !options.hide ) {
					status = new AFCH.status.Element( ( options.statusText || 'Editing' ) + ' $1...',
						{ '$1': $( '<a>' )
							.attr( 'href', mw.util.getUrl( pagename ) )
							.text( pagename.replace( /_/g, ' ' ) )
						} );
				} else {
					status = AFCH.consts.nullstatus;
				}

				request = {
					action: 'edit',
					text: options.contents,
					title: pagename,
					summary: options.summary + AFCH.prefs.summaryAd,
					token: AFCH.consts.editToken
				};

				if ( options.mode ) {
					request[options.mode] = true;
				}

				AFCH.api.post( request )
					.done( function ( data ) {
						if ( data && data.edit && data.edit.result && data.edit.result === 'Success' ) {
							deferred.resolve( data );
							status.update( 'Saved $1' );
						} else {
							deferred.reject( data );
							// FIXME: get detailed error info from API result??
							status.update( 'Error saving $1: ' + JSON.stringify( data ) );
						}
					} )
					.fail( function ( err ) {
						deferred.reject( err );
						status.update( 'Error saving $1: ' + JSON.stringify( err ) );
					} );

				return deferred;
			},

			/**
			 * Deletes a page
			 * @param  {string} pagename Page to delete
			 * @param  {string} reason   Reason for deletion; shown in deletion log
			 * @return {bool}            Page deleted successfully
			 */
			deletePage: function ( pagename, reason ) {
				// FIXME: implement
				return false;
			},

			/**
			 * Notifies a user. Follows redirects and appends a message
			 * to the bottom of the user's talk page.
			 * @param  {string} user
			 * @param  {object} data object with properties
			 *                   - message: {string}
			 *                   - summary: {string}
			 *                   - hide: {bool}, default false
			 * @return {$.Deferred} Resolves with success/failure
			 */
			notifyUser: function ( user, data ) {
				var deferred = $.Deferred,
					userTalkPage = new mw.Title( user, 3 ); // User talk namespace

				AFCH.actions.editPage( userTalkPage, {
					contents: data.message,
					summary: data.summary,
					mode: 'appendtext',
					statusText: 'Notifying',
					hide: data.hide || false
				} )
				.done( function () {
					deferred.resolve();
				} )
				.fail( function () {
					deferred.reject();
				} );

				return deferred;
			}
		},

		/**
		 * Series of functions for logging statuses and whatnot
		 */
		status: {

			/**
			 * Represents the status container, created ub init()
			 */
			container: false,

			/**
			 * Creates the status container
			 * @param  {selector} location String/jQuery selector for where the
			 *                             status container should be prepended
			 */
			init: function ( location ) {
				AFCH.status.container = $( '<div>' )
					.attr( 'id', 'afchStatus' )
					.addClass( 'afchStatus' )
					.prependTo( location || '#mw-content-text' );
			},

			/**
			 * Represents an element in the status container
			 * @param  {string} initialText Initial text of the element
			 * @param {object} substitutions key-value pairs of strings that should be replaced by something
			 *                               else. For example, { '$2': mw.user.getUser() }. If not redefined, $1
			 *                               will be equal to the current page name.
			 */
			Element: function ( initialText, substitutions ) {
				/**
				 * Replace the status element with new html content
				 * @param  {string} html Content of the element
				 *                       Can use $1 to represent the page name
				 */
				this.update = function ( html ) {
					// First run the substutions
					$.each( this.substitutions, function ( key, value ) {
						// If we are passed a jQuery object, convert it
						// to regular HTML first
						if ( value.jquery ) {
							value = value.wrap( '<div>' ).parent().html();
						}

						html = html.replace( key, value );
					} );
					// Then update the element
					this.element.html( html );
				};

				/**
				 * Remove the element from the status container
				 */
				this.remove = function () {
					this.update( '' );
				};

				// Sanity check, there better be a status container
				if ( !AFCH.status.container ) {
					AFCH.status.init();
				}

				if ( !substitutions ) {
					substitutions = { '$1': AFCH.consts.pagelink };
				} else {
					substitutions = $.extend( {}, { '$1': AFCH.consts.pagelink }, substitutions );
				}

				this.substitutions = substitutions;

				this.element = $( '<li>' )
					.appendTo( AFCH.status.container );

				this.update( initialText );
			}
		},

		/**
		 * A simple framework for getting/setting interface messages.
		 * Not every message necessarily needs to go through here. But
		 * it's nice to separate long messages from the code itself.
		 * @type {Object}
		 */
		msg: {
			/**
			 * AFCH messages loaded by default for all subscripts.
			 * @type {Object}
			 */
			store: {},

			/**
			 * Retrieve the text of a message, or a placeholder if the
			 * message is not set
			 * @param {string} key Message key
			 * @param {object} substitutions replacements to make
			 * @return {string} Message value
			 */
			get: function ( key, substitutions ) {
				var text = AFCH.msg.store[key] || '<' + key + '>';

				// Perform substitutions if necessary
				if ( substitutions ) {
					$.each( substitutions, function ( original, replacement ) {
						text = text.replace( original, replacement );
					} );
				}

				return text;
			},

			/**
			 * Set a new message or messages
			 * @param {string|object} key
			 * @param {string} value if key is a string, value
			 */
			set: function ( key, value ) {
				if ( typeof key === 'object' ) {
					$.extend( AFCH.msg.store, key );
				} else {
					AFCH.msg.store[key] = value;
				}
			}
		},

		/**
		 * Use Parsoid web api to parse the given wikitext
		 * @param {string} text Text to parse
		 * @param {bool} show display the request in the status list
		 * @return {$.Deferred} Resolves with a list of parsed templates
		 */
		parseTemplates: function ( text, show ) {
			var deferred = $.Deferred(),
				status = show ? new AFCH.status.Element( 'Parsing templates using Parsoid...' ) : AFCH.consts.nullstatus;

			// Sneakily use the Parsoid API which Flow has oh-so-nicely exposed
			// for us. Hopefully they don't, y'know, suddenly remove it.
			AFCH.api.get( {
				action: 'flow-parsoid-utils',
				from: 'wikitext',
				to: 'html',
				content: text,
				title: 'Main Page' // Teehee
			} ).done( function ( data ) {
				// Use the Parsoid data-mw attributes to gather a bunch of data about
				// the templates on the page, denoted by mw:Transclusion
				var rawTemplates = $( data['flow-parsoid-utils'].content ).find( '[typeof="mw:Transclusion"]' ),
					templates = [];

				rawTemplates.each( function ( _, t ) {
					// Get the data-mw attribute and then drill down through the JSON, whoopee!
					var tdata = ( $( t ).data( 'mw' ) ).parts[0].template,
						tmpl = { target: tdata.target.wt, params: {} };

					$.each( tdata.params, function ( k, v ) {
						tmpl.params[k] = v.wt;
					} );

					templates.push( tmpl );
				} );

				status.update( 'Templates parsed successfully!' );
				deferred.resolve( templates );
			} )
			.fail( function ( err ) {
				status.update( 'Error parsing templates: ' + JSON.stringify( err ) );
				deferred.reject( err );
			} );

			return deferred;
		},

		/**
		 * Represents a series of "views", aka templateable thingamajigs.
		 * When creating a set of views, they are loaded from a given piece of
		 * text. Uses <hogan.js>.
		 *
		 * Views on the cheap! Just use one mega template and divide it up into
		 * lots of baby templates :)
		 *
		 * @param {string} [src] text to parse for template contents initially
		 */
		Views: function ( src ) {
			this.views = {};

			this.setView = function ( name, content ) {
				this.views[name] = content;
			};

			this.renderView = function ( name, data ) {
				var view = this.views[name],
					template = Hogan.compile( view );

				return template.render( data );
			};

			this.loadFromSrc = function ( src ) {
				var viewRegex = /<!--\s(.*?)\s-->\n([\s\S]*?)<!--\s\/(.*?)\s-->/g,
					match = viewRegex.exec( src );

				while ( match !== null ) {
					var key = match[1],
						content = match[2];

					this.setView( key, content );

					// Increment the match
					match = viewRegex.exec( src );
				}
			};

			this.loadFromSrc( src );
		},

		/**
		 * Represents a specific window into an AFCH.Views object
		 *
		 * @param {AFCH.Views} views location where the views are gleaned
		 * @param {jQuery} $element
		 */
		Viewer: function ( views, $element ) {
			this.views = views;
			this.$element = $element;

			this.previousState = false;

			this.loadView = function ( view, data ) {
				var code = this.views.renderView( view, data );

				// Update the view cache
				this.previousState = this.$element.clone( true );

				this.$element.html( code );
			};

			this.loadPrevious = function () {
				this.$element.replaceWith( this.previousState );
				this.$element = this.previousState;
			};
		},

		/**
		 * Removes a key from a given object and returns the value of the key
		 * @param {string} key
		 * @return {mixed}
		 */
		getAndDelete: function ( object, key ) {
			var v = object[key];
			delete object[key];
			return v;
		}
	} );


}( AFCH, jQuery, mediaWiki ) );
//</nowiki>
